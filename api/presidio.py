import json
import re
from collections import Counter
from functools import lru_cache
from http.server import BaseHTTPRequestHandler

from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer, RecognizerRegistry
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig


PRESIDIO_VERSION = "2.2.364"
LANGUAGE = "es"
MODEL = "es_core_news_md"
MAX_ITEMS = 80
MAX_TOTAL_CHARACTERS = 60_000

ALLOWED_ENTITIES = {
    "PERSON",
    "LOCATION",
    "ORGANIZATION",
    "EMAIL_ADDRESS",
    "PHONE_NUMBER",
    "URL",
    "IP_ADDRESS",
    "MAC_ADDRESS",
    "IBAN_CODE",
    "CREDIT_CARD",
    "CRYPTO",
    "MEDICAL_LICENSE",
    "ES_NIF",
    "ES_NIE",
    "ES_PASSPORT",
    "DATE_TIME",
    "CLINICAL_RECORD_NUMBER",
    "HEALTH_CARD_NUMBER",
    "POSTAL_ADDRESS_ES",
    "POSTAL_CODE_ES",
}

PLACEHOLDERS = {
    "PERSON": "XXXXXXXXXXX",
    "LOCATION": "[UBICACIÓN]",
    "ORGANIZATION": "[ORGANIZACIÓN]",
    "EMAIL_ADDRESS": "[CORREO]",
    "PHONE_NUMBER": "[TELÉFONO]",
    "URL": "[URL]",
    "IP_ADDRESS": "[DIRECCIÓN_IP]",
    "MAC_ADDRESS": "[DIRECCIÓN_MAC]",
    "IBAN_CODE": "[CUENTA_BANCARIA]",
    "CREDIT_CARD": "[TARJETA]",
    "CRYPTO": "[ACTIVO_CRIPTOGRÁFICO]",
    "MEDICAL_LICENSE": "[NÚMERO_COLEGIADO]",
    "ES_NIF": "[DOCUMENTO_IDENTIDAD]",
    "ES_NIE": "[DOCUMENTO_IDENTIDAD]",
    "ES_PASSPORT": "[DOCUMENTO_IDENTIDAD]",
    "DATE_TIME": "[FECHA]",
    "CLINICAL_RECORD_NUMBER": "[NÚMERO_HISTORIA]",
    "HEALTH_CARD_NUMBER": "[TARJETA_SANITARIA]",
    "POSTAL_ADDRESS_ES": "[DIRECCIÓN_POSTAL]",
    "POSTAL_CODE_ES": "[CÓDIGO_POSTAL]",
}

CLINICAL_ROLE_LABELS = {
    "PACIENTE",
    "MADRE",
    "PADRE",
    "FAMILIAR",
    "PSIQUIATRA",
    "PROFESIONAL",
    "CUIDADOR",
    "CUIDADORA",
    "ACOMPAÑANTE",
    "CP",
    "NHC",
    "CIP",
    "CIPA",
    "SIP",
    "TIS",
    "DNI",
    "NIF",
    "NIE",
}

ABSOLUTE_DATE_RE = re.compile(
    r"(?:\b\d{1,2}[/-]\d{1,2}[/-](?:\d{2}|\d{4})\b|"
    r"\b\d{4}-\d{2}-\d{2}\b|"
    r"\b\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)"
    r"(?:\s+de\s+\d{4})?\b)",
    re.IGNORECASE,
)


def _custom_recognizers():
    return [
        PatternRecognizer(
            supported_entity="CLINICAL_RECORD_NUMBER",
            supported_language=LANGUAGE,
            patterns=[Pattern(
                name="numero_historia_es",
                regex=r"\b(?:NHC|historia\s+cl[ií]nica|n[uú]mero\s+de\s+historia)\s*[:#-]?\s*[A-Z0-9]{5,20}\b",
                score=0.9,
            )],
            context=["nhc", "historia", "clínica", "paciente"],
        ),
        PatternRecognizer(
            supported_entity="HEALTH_CARD_NUMBER",
            supported_language=LANGUAGE,
            patterns=[Pattern(
                name="tarjeta_sanitaria_es",
                regex=r"\b(?:CIP|CIPA|SIP|TIS|tarjeta\s+sanitaria)\s*[:#-]?\s*[A-Z0-9]{6,20}\b",
                score=0.9,
            )],
            context=["cip", "cipa", "sip", "tis", "tarjeta", "sanitaria"],
        ),
        PatternRecognizer(
            supported_entity="POSTAL_ADDRESS_ES",
            supported_language=LANGUAGE,
            patterns=[Pattern(
                name="direccion_postal_es",
                regex=r"\b(?:calle|c/|avenida|avda\.?|plaza|paseo|carretera|camino)\s+[A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ.' -]{1,60}\s+\d{1,4}\b",
                score=0.75,
            )],
            context=["vive", "domicilio", "dirección", "calle", "avenida"],
        ),
        PatternRecognizer(
            supported_entity="PHONE_NUMBER",
            supported_language=LANGUAGE,
            patterns=[
                Pattern(
                    name="telefono_es_prefijo",
                    regex=r"(?<!\w)(?:\+34|0034)[ .-]?[6789](?:[ .-]?\d){8}\b",
                    score=0.85,
                ),
                Pattern(
                    name="telefono_es_nacional",
                    regex=r"\b[6789](?:[ .-]?\d){8}\b",
                    score=0.55,
                ),
            ],
            context=["teléfono", "telefono", "tel", "móvil", "movil", "llamar", "contacto"],
        ),
        PatternRecognizer(
            supported_entity="PERSON",
            supported_language=LANGUAGE,
            patterns=[
                Pattern(
                    name="nombre_presentacion_me_llamo",
                    regex=r"(?<=\bme llamo )[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'-]+(?:\s+(?!(?:y|e|en|vivo|viva|tengo|soy|pero|porque)\b)[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'-]+){0,3}",
                    score=0.9,
                ),
                Pattern(
                    name="nombre_presentacion_nombre_es",
                    regex=r"(?<=\bmi nombre es )[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'-]+(?:\s+(?!(?:y|e|en|vivo|viva|tengo|soy|pero|porque)\b)[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'-]+){0,3}",
                    score=0.9,
                ),
            ],
            context=["llamo", "nombre", "identifica"],
        ),
        PatternRecognizer(
            supported_entity="ES_PASSPORT",
            supported_language=LANGUAGE,
            patterns=[Pattern(
                name="pasaporte_es_contextual",
                regex=r"\b[A-Z]{3}\d{6}\b",
                score=0.55,
            )],
            context=["pasaporte", "documento", "identidad"],
        ),
        PatternRecognizer(
            supported_entity="DATE_TIME",
            supported_language=LANGUAGE,
            patterns=[
                Pattern(
                    name="fecha_numerica_es",
                    regex=r"\b(?:\d{1,2}[/-]\d{1,2}[/-](?:\d{2}|\d{4})|\d{4}-\d{2}-\d{2})\b",
                    score=0.85,
                ),
                Pattern(
                    name="fecha_textual_es",
                    regex=r"\b\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+de\s+\d{4})?\b",
                    score=0.85,
                ),
            ],
            context=["fecha", "nacimiento", "nació", "nacida", "cita"],
        ),
        PatternRecognizer(
            supported_entity="POSTAL_CODE_ES",
            supported_language=LANGUAGE,
            patterns=[Pattern(
                name="codigo_postal_es",
                regex=r"\b(?:0[1-9]|[1-4]\d|5[0-2])\d{3}\b",
                score=0.45,
            )],
            context=["código postal", "codigo postal", "cp", "domicilio", "dirección"],
        ),
    ]


@lru_cache(maxsize=1)
def _engines():
    nlp_configuration = {
        "nlp_engine_name": "spacy",
        "models": [{"lang_code": LANGUAGE, "model_name": MODEL}],
        "ner_model_configuration": {
            "model_to_presidio_entity_mapping": {
                "PER": "PERSON",
                "PERSON": "PERSON",
                "LOC": "LOCATION",
                "LOCATION": "LOCATION",
                "GPE": "LOCATION",
                "ORG": "ORGANIZATION",
                "ORGANIZATION": "ORGANIZATION",
                "DATE": "DATE_TIME",
                "TIME": "DATE_TIME",
            },
            "low_confidence_score_multiplier": 0.4,
            "low_score_entity_names": ["ORGANIZATION"],
            "default_score": 0.85,
        },
    }
    nlp_engine = NlpEngineProvider(nlp_configuration=nlp_configuration).create_engine()
    registry = RecognizerRegistry(supported_languages=[LANGUAGE])
    registry.load_predefined_recognizers(
        languages=[LANGUAGE],
        nlp_engine=nlp_engine,
        countries=["es"],
    )
    for recognizer in _custom_recognizers():
        registry.add_recognizer(recognizer)

    analyzer = AnalyzerEngine(
        nlp_engine=nlp_engine,
        registry=registry,
        supported_languages=[LANGUAGE],
    )
    return analyzer, AnonymizerEngine()


def _keep_result(text, result):
    if result.entity_type not in ALLOWED_ENTITIES:
        return False
    detected = text[result.start:result.end]
    if result.entity_type in {"PERSON", "LOCATION", "ORGANIZATION"}:
        normalized = detected.strip(" .,:;-").upper()
        if normalized in CLINICAL_ROLE_LABELS:
            return False
        # El NER español puede etiquetar síntomas aislados en minúscula como PERSON.
        # La segunda barrera de nombres revisa después los nombres no capitalizados.
        if result.entity_type == "PERSON" and " " not in detected.strip() and detected.islower():
            return False
    if result.entity_type != "DATE_TIME":
        return True
    context_start = max(0, result.start - 35)
    context = text[context_start:result.end].lower()
    return bool(
        ABSOLUTE_DATE_RE.search(detected)
        or re.search(r"(?:fecha\s+de\s+nacimiento|naci[oó]\s+el|nacida?\s+el)", context)
    )


def _deidentify_text(text):
    analyzer, anonymizer = _engines()
    detected = analyzer.analyze(text=text, language=LANGUAGE, score_threshold=0.45)
    filtered = [result for result in detected if _keep_result(text, result)]
    operators = {
        entity: OperatorConfig("replace", {"new_value": PLACEHOLDERS[entity]})
        for entity in ALLOWED_ENTITIES
    }
    output = anonymizer.anonymize(
        text=text,
        analyzer_results=filtered,
        operators=operators,
    )
    counts = Counter(item.entity_type for item in output.items)
    return output.text, len(output.items), dict(sorted(counts.items()))


class handler(BaseHTTPRequestHandler):
    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            length = int(self.headers.get("content-length", "0"))
            if length <= 0 or length > 1_000_000:
                return self._json(413, {"error": "invalid_payload", "message": "La solicitud supera el tamaño permitido."})

            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if payload.get("language") != LANGUAGE:
                return self._json(400, {"error": "unsupported_language", "message": "Presidio está configurado para español."})

            raw_items = payload.get("items")
            if not isinstance(raw_items, list) or not raw_items or len(raw_items) > MAX_ITEMS:
                return self._json(400, {"error": "invalid_items", "message": "La lista de fragmentos no es válida."})

            seen = set()
            items = []
            total_characters = 0
            for raw in raw_items:
                item_id = str(raw.get("id", "")).strip()
                text = str(raw.get("text", ""))
                if not item_id or not text.strip() or item_id in seen:
                    return self._json(400, {"error": "invalid_item", "message": "Hay fragmentos incompletos o duplicados."})
                seen.add(item_id)
                total_characters += len(text)
                if total_characters > MAX_TOTAL_CHARACTERS:
                    return self._json(413, {"error": "items_too_large", "message": "Los fragmentos superan el tamaño permitido."})

                anonymized, replacements, entity_counts = _deidentify_text(text)
                if not anonymized.strip():
                    raise RuntimeError("Presidio devolvió un fragmento vacío.")
                items.append({
                    "id": item_id,
                    "text": anonymized,
                    "replacements": replacements,
                    "entity_counts": entity_counts,
                })

            self._json(200, {
                "engine": "presidio",
                "version": PRESIDIO_VERSION,
                "language": LANGUAGE,
                "model": MODEL,
                "items": items,
            })
        except json.JSONDecodeError:
            self._json(400, {"error": "invalid_json", "message": "La solicitud no contiene JSON válido."})
        except Exception:
            self._json(502, {
                "error": "presidio_failed",
                "message": "No se pudo verificar la anonimización. No se ha conservado el texto.",
            })

    def do_GET(self):
        self._json(200, {
            "ok": True,
            "engine": "presidio",
            "version": PRESIDIO_VERSION,
            "language": LANGUAGE,
            "model": MODEL,
            "store": False,
            "fail_closed": True,
        })
