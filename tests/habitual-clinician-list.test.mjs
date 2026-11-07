import test from 'node:test';
import assert from 'node:assert/strict';
import {applyClinicalPostprocessing,finalizeVerifiedMedicationNames} from '../server/clinical-postprocess.mjs';
import {renderClinicalReport} from '../server/render-report.mjs';
import {verifyAssessmentMedications,verifyReportMedicationMentions} from '../server/medication-verification.mjs';
import {groundReportContentToTranscript} from '../server/report-content-grounding.mjs';
const transcript=`PSIQUIATRA: El tratamiento que tiene en este momento es fluoxetina en la mañana 20 miligramos.
PSIQUIATRA: y mirtazapina por la noche de 15 miligramos.
PSIQUIATRA: Ese es el tratamiento que vamos a cambiar y lo vamos a hacer de la siguiente manera.
PSIQUIATRA: Por la mañana vamos a poner...
PSIQUIATRA: 60 miligramos un comprimido y por la noche lorazepam de 2 miligramos un comprimido.`;
function base(){return {sources:[{id:'s',kind:'psychiatrist'}],sections:{motivo_consulta:{text:'Revisión y modificación del tratamiento farmacológico.'},plan_terapeutico:{text:'Se indica modificación del tratamiento farmacológico.'},tratamiento_habitual:{text:'',evidence_status:'not_provided'},tratamiento_actual:{text:'',evidence_status:'not_provided'}},medications:{habitual:[],current:[]}};}
test('explicit clinician history and list continuation survive all deterministic report stages',async()=>{
 let a=applyClinicalPostprocessing(base(),transcript).assessment;
 assert.deepEqual(a.medications.habitual.map(m=>[m.raw_name,m.dose]),[['Fluoxetina','20 mg'],['Mirtazapina','15 mg']]);
 a=(await verifyAssessmentMedications(a,{fetchFn:async()=>({ok:true,json:async()=>({resultados:[]})})})).assessment;
 a=finalizeVerifiedMedicationNames(a).assessment;
 a=groundReportContentToTranscript(a,transcript).assessment;
 const report=renderClinicalReport(a);
 assert.match(report,/TRATAMIENTO HABITUAL\nFluoxetina[^\n]*20 mg: 1 - 0 - 0\nMirtazapina[^\n]*15 mg: 0 - 0 - 1/);
 assert.match(report,/TRATAMIENTO REVISADO\nLorazepam[^\n]*2 mg: 0 - 0 - 1/);
 assert.match(report,/AVISO — Pauta incompleta: medicamento no identificado, 60 mg/);
 assert.doesNotMatch(report,/Duloxetina/);
});
test('CIMA does not treat clinical action nouns as medicines',async()=>{
 let calls=0;const a=base();
 const result=await verifyReportMedicationMentions(a,{fetchFn:async()=>{calls++;return {ok:true,json:async()=>({resultados:[]})};}});
 assert.equal(calls,0);
 assert.equal(result.assessment.sections.plan_terapeutico.text,a.sections.plan_terapeutico.text);
 assert.equal(result.assessment.sections.motivo_consulta.text,a.sections.motivo_consulta.text);
});
test('unknown medicine with an explicit dose still requires CIMA checking',async()=>{
 let calls=0;const a=base();a.sections.plan_terapeutico.text='Se indica farmacoexperimental 25 mg.';
 const r=await verifyReportMedicationMentions(a,{fetchFn:async()=>{calls++;return {ok:true,json:async()=>({resultados:[]})};}});
 assert.ok(calls>0);assert.match(r.assessment.sections.plan_terapeutico.text,/no encontrada correspondencia en CIMA/);
});
test('positive dose notes do not obscure regimens; off-label and incomplete reviews remain',()=>{
 const a=applyClinicalPostprocessing(base(),transcript).assessment;
 const m=a.medications.current[0];
 m.cima_dose_review={status:'within_cima_range',note:'rango informativo'};
 assert.doesNotMatch(renderClinicalReport(a),/rango informativo/);
 m.cima_dose_review={status:'off_label_dose',note:'requiere revisión'};
 assert.match(renderClinicalReport(a),/OFF-LABEL/);
 m.cima_dose_review={status:'not_assessable',note:'no verificable'};
 assert.match(renderClinicalReport(a),/no verificable/);
});
test('history continuation stops at the new prescription',()=>{
 const a=applyClinicalPostprocessing(base(),transcript+'\nPSIQUIATRA: y escitalopram 10 mg por la mañana.').assessment;
 assert.deepEqual(a.medications.habitual.map(m=>m.raw_name),['Fluoxetina','Mirtazapina']);
 assert.ok(a.medications.current.some(m=>m.raw_name==='Escitalopram'));
});
