import { decodeStructToObject } from "../src/utils/decode-struct-to-object";
import { encodeObjectToStruct } from "../src/utils/encode-object-to-struct";

function objectToStructToObject(object: any) {
  return decodeStructToObject(encodeObjectToStruct(object));
}

describe("objectToStructToObject", () => {
  it("should create the same object -- number", () => {
    const testObject = {
      a: 1,
    };

    expect(objectToStructToObject(testObject)).toEqual(testObject);
  });

  it("should create the same object -- string", () => {
    const testObject = {
      a: "a",
    };

    expect(objectToStructToObject(testObject)).toEqual(testObject);
  });

  it("should create the same object -- boolean", () => {
    const testObject = {
      a: true,
    };

    expect(objectToStructToObject(testObject)).toEqual(testObject);
  });

  it("should create the same object -- null", () => {
    const testObject = {
      a: null,
    };

    expect(objectToStructToObject(testObject)).toEqual(testObject);
  });

  it("should create the same object -- nested", () => {
    const testObject = {
      a: {
        b: {
          c: 1,
        },
      },
    };

    expect(objectToStructToObject(testObject)).toEqual(testObject);
  });

  it("should create the same object -- array", () => {
    const testObject = {
      a: [1, 2, 3],
    };

    console.log(JSON.stringify(encodeObjectToStruct(testObject), null, 2));

    expect(objectToStructToObject(testObject)).toEqual(testObject);
  });

  it("should create the same object -- array of objects", () => {
    const testObject = {
      a: [
        {
          b: 1,
        },
        {
          c: 2,
        },
      ],
    };

    expect(objectToStructToObject(testObject)).toEqual(testObject);
  });
});
