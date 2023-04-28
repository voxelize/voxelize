export function decodeStructToObject(struct: any): any {
  if (typeof struct !== "object" || struct === null) {
    return decodeStructValue(struct);
  }

  const convertedObject = {};

  for (const prop in struct.fields) {
    if (struct.fields.hasOwnProperty(prop)) {
      const value = struct.fields[prop];
      convertedObject[prop] = decodeStructValue(value);
    }
  }

  return convertedObject;
}

function decodeStructValue(value: any): any {
  if (value === null || value === undefined) {
    return null;
  }

  if (value.numberValue !== undefined) {
    return value.numberValue;
  }

  if (value.stringValue !== undefined) {
    return value.stringValue;
  }

  if (value.boolValue !== undefined) {
    return value.boolValue;
  }

  if (value.structValue !== undefined) {
    return decodeStructToObject(value.structValue);
  }

  if (value.listValue !== undefined) {
    return value.listValue.values.map(decodeStructValue);
  }

  if (value.nullValue !== undefined) {
    return null;
  }

  return value;
}
