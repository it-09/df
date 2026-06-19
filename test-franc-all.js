import { franc, francAll } from 'franc-min';

console.log('Testing francAll');

const englishText = 'The quick brown fox jumps over the lazy dog. This is a test sentence to check the language detection system.';
const spanishText = 'El rápido zorro marrón salta sobre el perro perezoso. Esta es una oración de prueba para verificar el sistema de detección de idiomas.';

console.log('English francAll:', francAll(englishText));
console.log('Spanish francAll:', francAll(spanishText));
