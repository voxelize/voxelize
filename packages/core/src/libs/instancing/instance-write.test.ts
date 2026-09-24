import assert from "node:assert/strict";

import * as THREE from "three";
import { describe, it } from "vitest";

import { writeInstanceColor, writeInstanceMatrix } from "./instance-write";

const makeMesh = () =>
  new THREE.InstancedMesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial(),
    4,
  );

describe("writeInstanceMatrix", () => {
  it("does not dirty the buffer when the matrix is unchanged", () => {
    const mesh = makeMesh();
    const matrix = new THREE.Matrix4().makeTranslation(1, 2, 3);

    writeInstanceMatrix(mesh, 2, matrix);
    const versionAfterFirst = mesh.instanceMatrix.version;

    writeInstanceMatrix(mesh, 2, matrix);
    assert.equal(mesh.instanceMatrix.version, versionAfterFirst);

    matrix.makeTranslation(4, 5, 6);
    writeInstanceMatrix(mesh, 2, matrix);
    assert.equal(mesh.instanceMatrix.version, versionAfterFirst + 1);

    const readBack = new THREE.Matrix4();
    mesh.getMatrixAt(2, readBack);
    assert.equal(readBack.equals(matrix), true);
  });

  it("tracks slots independently", () => {
    const mesh = makeMesh();
    const matrix = new THREE.Matrix4().makeTranslation(1, 0, 0);
    writeInstanceMatrix(mesh, 0, matrix);
    const version = mesh.instanceMatrix.version;

    writeInstanceMatrix(mesh, 1, matrix);
    assert.equal(mesh.instanceMatrix.version, version + 1);
  });
});

describe("writeInstanceColor", () => {
  it("does not dirty the buffer when the color is unchanged", () => {
    const attribute = new THREE.InstancedBufferAttribute(
      new Float32Array(4 * 3).fill(1),
      3,
    );

    writeInstanceColor(attribute, 1, 1, 1, 1);
    assert.equal(attribute.version, 0);

    writeInstanceColor(attribute, 1, 0.5, 1, 1);
    assert.equal(attribute.version, 1);
    assert.equal(attribute.getX(1), 0.5);

    writeInstanceColor(attribute, 1, 0.5, 1, 1);
    assert.equal(attribute.version, 1);
  });
});
