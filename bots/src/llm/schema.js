// Validation minimale (sous-ensemble de JSON Schema) des arguments renvoyés par le modèle.
// On ne fait pas confiance au modèle : chaque sortie est vérifiée avant exécution.

function validate(schema, value, where = 'arguments') {
  const errors = [];
  check(schema, value, where, errors);
  return errors;
}

function typeOf(v) {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  if (typeof v === 'number' && Number.isInteger(v)) return 'integer';
  return typeof v;
}

function check(schema, value, where, errors) {
  const t = typeOf(value);
  const expected = schema.type;
  const typeOk = !expected || t === expected || (expected === 'number' && t === 'integer');
  if (!typeOk) {
    errors.push(`${where} doit être de type ${expected} (reçu ${t})`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${where} doit valoir l'une des valeurs ${JSON.stringify(schema.enum)}`);
  }
  if (t === 'string') {
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${where} dépasse ${schema.maxLength} caractères`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${where} est trop court`);
  }
  if (t === 'integer' || t === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${where} doit être >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${where} doit être <= ${schema.maximum}`);
  }
  if (t === 'object' && schema.properties) {
    for (const req of schema.required ?? []) {
      if (!(req in value)) errors.push(`${where}.${req} est obligatoire`);
    }
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties[k]) check(schema.properties[k], v, `${where}.${k}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${where}.${k} n'est pas autorisé`);
    }
  }
  if (t === 'array' && schema.items) {
    value.forEach((v, i) => check(schema.items, v, `${where}[${i}]`, errors));
  }
}

module.exports = { validate };
