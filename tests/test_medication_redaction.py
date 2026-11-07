import ast
import re
import unittest
from pathlib import Path
from types import SimpleNamespace

source = ast.parse((Path(__file__).parents[1] / 'api/presidio.py').read_text())
function = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == '_keep_result')
scope = dict(re=re, ALLOWED_ENTITIES={'PERSON'}, CLINICAL_ROLE_LABELS=set(), CLINICAL_NON_ENTITIES=set())
exec(compile(ast.Module(body=[function], type_ignores=[]), '<privacy-filter>', 'exec'), scope)
keep = scope['_keep_result']
class MedicationProtection(unittest.TestCase):
    def test_exact_medication_and_partial_ner_span(self):
        text='Duloxetina 60 mg por la mañana'
        for end in (4, 10):
            self.assertFalse(keep(text, SimpleNamespace(entity_type='PERSON', start=0, end=end)))
    def test_person_is_still_redacted(self):
        text='Ana toma Duloxetina 60 mg'
        self.assertTrue(keep(text, SimpleNamespace(entity_type='PERSON', start=0, end=3)))
    def test_broad_span_is_not_whitelisted(self):
        text='Ana Duloxetina 60 mg'
        self.assertTrue(keep(text, SimpleNamespace(entity_type='PERSON', start=0, end=14)))
if __name__ == '__main__': unittest.main()
