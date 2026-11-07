import assert from 'node:assert/strict';
import {applyClinicalPostprocessing} from './clinical-postprocess.mjs';
const transcript = `PSIQUIATRA: El tratamiento que usted hace según literalmente viene en su informe es yo tomo 15 miligramos de mirtazapina por la noche y 50 miligramos de sertralina por la mañana.
PSIQUIATRA: ¿Es esto el tratamiento que usted realiza?
PSIQUIATRA: Vamos a modificarlo y va a tomar usted escitalopram por la mañana 10 miligramos.
PSIQUIATRA: XXXXXXXXXXX cetina 60 miligramos por la mañana,
PSIQUIATRA: fluoxetina por la mañana 20 miligramos.`;
const base={sources:[{id:'s1',kind:'psychiatrist'}],medications:{habitual:[],current:[]},sections:{tratamiento_habitual:{text:'',source_ids:[]},tratamiento_actual:{text:'',source_ids:[]}}};
const meds=t=>applyClinicalPostprocessing(base,t).assessment.medications;
const tuples=list=>list.map(m=>[m.raw_name,m.dose,m.schedule]);
assert.deepEqual(tuples(meds(transcript).habitual),[['Mirtazapina','15 mg','por la noche'],['Sertralina','50 mg','por la manana']]);
assert.deepEqual(tuples(meds(transcript).current),[['Escitalopram','10 mg','por la manana'],['Fluoxetina','20 mg','por la manana']]);
const old=`PSIQUIATRA: Según aparece en el informe y
PSIQUIATRA: textualmente usted dice,
PSIQUIATRA: yo tomo sertralina de 50 miligramos por la mañana y mirtazapina de 15 miligramos por la noche.
PSIQUIATRA: Este es el tratamiento que vamos a cambiar por el siguiente.
PSIQUIATRA: Fluoxetina de veinte miligramos por la mañana,
PSIQUIATRA: escitalopram de diez miligramos por la mañana,
PSIQUIATRA: duloxetina de sesenta miligramos por la mañana y venlafaxina de ciento cincuenta miligramos por la mañana.`;
assert.deepEqual(meds(old).habitual.map(m=>m.dose),['50 mg','15 mg']);
assert.deepEqual(meds(old).current.map(m=>m.dose),['20 mg','10 mg','60 mg','150 mg']);
assert.equal(meds('MADRE: Yo tomo 15 miligramos de mirtazapina por la noche.').habitual.length,0);
assert.equal(meds('PSIQUIATRA: Vamos a valorar modificar el tratamiento.').current.length,0);
assert.equal(meds(transcript.replace('va a tomar usted','usted va a tomar')).current.length,2);
console.log('PASS: 7 regression assertions');
