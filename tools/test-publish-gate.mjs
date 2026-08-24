import assert from "node:assert/strict";
import { buildPublishGatePayload } from "../src/publish-gate.js";

const artifactHashes = {
  structure: "structure-hash",
  video: "video-hash",
  thumbnail: "thumbnail-hash",
  title: "title-hash",
  description: "description-hash",
};

assert.deepEqual(
  buildPublishGatePayload({ projectId: "project-1", gateToken: "gate-token", artifactHashes }),
  {
    mg_project_id: "project-1",
    gate_token: "gate-token",
    artifact_hashes: artifactHashes,
  },
);

console.log("publish gate payload regression tests passed");
