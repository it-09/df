import { franc } from 'franc-min';

console.log('Testing franc-min');

const englishText = 'The quick brown fox jumps over the lazy dog';
const spanishText = 'El rápido zorro marrón salta sobre el perro perezoso';
const germanText = 'Der schnelle braune Fuchs springt über den faulen Hund';

console.log('English:', franc(englishText));
console.log('Spanish:', franc(spanishText));
console.log('German:', franc(germanText));
console.log('Short text (too short):', franc('Hello'));
