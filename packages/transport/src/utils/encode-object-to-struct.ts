export function encodeObjectToStruct(
  obj: any,
  seenObjects: Set<any> = new Set()
): any {
  if (typeof obj !== "object" || obj === null) {
    return encodeStructValue(obj, seenObjects);
  }

  const convertedObject = {
    fields: {},
  };

  seenObjects.add(obj);

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = obj[key];

      if (value === undefined) {
        continue;
      }

      convertedObject.fields[key] = encodeStructValue(value, seenObjects);
    }
  }

  seenObjects.delete(obj);

  return convertedObject;
}

function encodeStructValue(value: any, seenObjects: Set<any>): any {
  if (value === null || value === undefined) {
    return {
      nullValue: 0,
    };
  } else if (typeof value === "number") {
    return {
      numberValue: value,
    };
  } else if (typeof value === "string") {
    return {
      stringValue: value,
    };
  } else if (typeof value === "boolean") {
    return {
      boolValue: value,
    };
  } else if (Array.isArray(value)) {
    return {
      listValue: {
        values: value.map((v) => encodeStructValue(v, seenObjects)),
      },
    };
  } else if (typeof value === "object") {
    if (seenObjects.has(value)) {
      console.warn("Circular object detected");

      return {
        stringValue: "[Circular]",
      };
    }

    return {
      structValue: encodeObjectToStruct(value, seenObjects),
    };
  }

  throw new Error(`Unknown type: ${typeof value}`);
}
