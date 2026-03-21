# EditPro Agent Registry

This directory configures the [agent-tools](https://github.com/Unwrenchable/agent-tools) governance framework for EditPro.

## Quick start

```bash
pip install -e path/to/agent-tools
agentx list
agentx find photo
agentx check editpro-orchestrator --profile power
agentx recommend editpro-electron-engineer
```

## Agents defined here

| ID | Role | Profile |
|----|------|---------|
| editpro-orchestrator | Multi-Agent Orchestrator | power |
| editpro-photo-engine | Photo Engine Engineer | balanced |
| editpro-video-engine | Video Engine Engineer | balanced |
| editpro-electron-engineer | Electron / Desktop Engineer | power |
| editpro-ui-engineer | UI / React Engineer | balanced |
| editpro-test-engineer | Test Engineer | balanced |
| editpro-release-engineer | Release & Packaging Engineer | power |
| editpro-security-engineer | Security Engineer | safe |

## Access profiles

See `access_profiles.json` for the three profiles used in EditPro:
- **safe** – read-only audit/analysis
- **balanced** – standard feature development (write, no external network)
- **power** – cross-repo work, Electron packaging, CI orchestration
