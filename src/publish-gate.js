export function buildPublishGatePayload({ projectId, gateToken, artifactHashes }) {
  return {
    mg_project_id: projectId,
    gate_token: gateToken,
    artifact_hashes: artifactHashes,
  };
}
