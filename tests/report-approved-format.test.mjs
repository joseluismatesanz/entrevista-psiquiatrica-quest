import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {applyClinicalPostprocessing} from '../server/clinical-postprocess.mjs';
import {applyClinicalInvariants} from '../server/clinical-invariants.mjs';
import {renderClinicalReport, SECTION_ORDER} from '../server/render-report.mjs';
const base=()=>({sources:[],sections:Object.fromEntries(SECTION_ORDER.map(([k])=>[k,{text:'',evidence_status:'not_provided',source_ids:[]}])),medications:{habitual:[],current:[]},missing_or_not_explored:[],validation:{},diagnostic_judgment:{primary_diagnosis:'Diagnóstico documentado A',cie10_code:'F41.1',dsm5_code:'F41.1',differential:[],secondary_diagnoses:[]}});
test('maintained medication plus two additions stays in both snapshots',()=>{
 const a=base();
 const transcript=`PSIQUIATRA: ¿Qué tratamiento toma habitualmente?
PACIENTE: Tomo fluoxetina 40 mg por la mañana y al mediodía.
PSIQUIATRA: Mantenemos fluoxetina 40 mg por la mañana y al mediodía. Añadimos trazodona 100 mg por la noche y mirtazapina 15 mg por la noche.`;
 const r=applyClinicalPostprocessing(a,transcript).assessment;
 assert.deepEqual(r.medications.habitual.map(x=>x.raw_name),['Fluoxetina']);
 assert.deepEqual(r.medications.current.map(x=>x.raw_name),['Fluoxetina','Trazodona','Mirtazapina']);
 assert.match(renderClinicalReport(r),/Fluoxetina 40 mg: 1 - 1 - 0/);
});
test('confirmed duloxetine renders the requested numeric regimen',()=>{
 const a=base();a.medications.current=[{raw_name:'Duloxetina',dose:'60 mg',schedule:'1-0-0.',status:'active'}];
 assert.match(renderClinicalReport(a),/Duloxetina 60 mg: 1 - 0 - 0/);
});
test('every established diagnosis is rendered with its own codes',()=>{
 const a=base();a.diagnostic_judgment.secondary_diagnoses=[{diagnosis:'Diagnóstico documentado B',cie10_code:'F42',dsm5_code:'F42',provisional:true}];
 const text=applyClinicalInvariants(a).assessment.sections.orientacion_diagnostica.text;
 assert.match(text,/Diagnóstico documentado A.*F41.1/);
 assert.match(text,/Diagnóstico documentado B \(provisional\).*CIE-10: F42.*DSM-5-TR \(CIE-10-MC\): F42/);
});
test('legacy numeric codes are not presented as verified DSM-5-TR codes',()=>{
 const a=base();a.diagnostic_judgment.dsm5_code='300.02';
 assert.match(applyClinicalInvariants(a).assessment.sections.orientacion_diagnostica.text,/DSM-5-TR \(CIE-10-MC\): pendiente de verificación/);
});
test('document exports inline headings and safe bold HTML without editor controls',()=>{
 const block={querySelector:s=>({textContent:s==='h3'?'TRATAMIENTO REVISADO':'Duloxetina 60 mg: 1 - 0 - 0\n<texto>'})};
 const editor={querySelector:()=>block,querySelectorAll:()=>[block]};
 const document={getElementById:id=>id==='reportEditor'?editor:null,addEventListener(){}};
 const window={addEventListener(){}};
 vm.runInNewContext(readFileSync(new URL('../../report-v056.js',import.meta.url),'utf8'),{window,document,setTimeout});
 assert.equal(window.getClinicalReportText(),'TRATAMIENTO REVISADO Duloxetina 60 mg: 1 - 0 - 0\n<texto>');
 assert.equal(window.getClinicalReportHtml(),'<p><strong>TRATAMIENTO REVISADO</strong> Duloxetina 60 mg: 1 - 0 - 0<br>&lt;texto&gt;</p>');
});
