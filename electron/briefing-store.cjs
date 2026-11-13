const { FACT_TYPES } = require('./briefing.cjs');

function createBriefingStore({ db, event, now }) {
  const factTypes = JSON.stringify(FACT_TYPES);
  return {
    briefingSources(projectIds, since) {
      const ids = JSON.stringify(projectIds);
      const inProjects = 'IN (SELECT value FROM json_each(?))';
      return {
        events: since ? db.prepare(`SELECT e.id, e.type, e.project_id, e.payload, e.created_at,
          s.name AS session_name, t.title AS task_title, r.reason AS run_reason
          FROM audit_events e LEFT JOIN sessions s ON s.id = e.session_id
          LEFT JOIN agent_runs r ON r.id = e.run_id
          LEFT JOIN regression_runs g ON g.id = json_extract(e.payload, '$.regressionRunId')
          LEFT JOIN tasks t ON t.id = coalesce(json_extract(e.payload, '$.taskId'), g.task_id)
            AND t.project_id = e.project_id
          WHERE e.project_id ${inProjects} AND e.created_at > ? AND e.type ${inProjects}
          ORDER BY e.created_at DESC, e.sequence DESC`).all(ids, since, factTypes).map((row) => ({ ...row, payload: JSON.parse(row.payload) })) : [],
        sessions: db.prepare(`SELECT s.id, s.name, s.cli, s.role, s.project_id AS projectId, s.cwd,
            s.attachment, r.id AS runId, r.function_slug AS functionSlug, t.id AS taskId, t.title AS taskTitle
          FROM sessions s JOIN agent_runs r ON r.session_id = s.id AND r.state = 'running'
          LEFT JOIN tasks t ON t.claim_run_id = r.id AND t.project_id = s.project_id
          WHERE s.removed_at IS NULL AND s.project_id ${inProjects} ORDER BY s.created_at, s.id, t.id`).all(ids),
        principalProjectIds: db.prepare(`SELECT project_id FROM sessions WHERE role = 'orchestrator' AND project_id ${inProjects}`).all(ids).map(({ project_id }) => project_id),
      };
    },
    getBriefingRun: (id) => db.prepare('SELECT id, session_id, state FROM agent_runs WHERE id = ?').get(id),
    getBriefingReceipt(projectId, key) {
      const row = db.prepare(`SELECT session_id AS sessionId, run_id AS runId, created_at AS at, type FROM audit_events
        WHERE project_id = ? AND correlation_id = ? AND type IN ('briefing.sending', 'briefing.sent')`).get(projectId, key);
      return row ? { sessionId: row.sessionId, runId: row.runId, at: row.at, sent: row.type === 'briefing.sent' } : null;
    },
    reserveBriefingSend({ projectId, sessionId, runId, length, key }) {
      const at = now();
      event({ projectId, sessionId, runId, type: 'briefing.sending', payload: { length }, at, correlationId: key });
      return { sessionId, runId, at };
    },
    confirmBriefingSend(projectId, key) {
      db.prepare("UPDATE audit_events SET type = 'briefing.sent' WHERE project_id = ? AND correlation_id = ? AND type = 'briefing.sending'").run(projectId, key);
    },
  };
}

module.exports = { createBriefingStore };
