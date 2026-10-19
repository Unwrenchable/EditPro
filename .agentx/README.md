# EditPro Agent Registry

This directory configures the [agent-tools](https://github.com/Unwrenchable/agent-tools) governance framework for EditPro. The toolkit is a Python 3.11+ package. Its `agentx` CLI is the `project.scripts` entry in that repo's `pyproject.toml`.

## Quick start

From the EditPro repository root:

```bash
pip install git+https://github.com/Unwrenchable/agent-tools.git
python -m pip install requests
agentx list
agentx find photo
agentx check editpro-orchestrator --profile power
agentx recommend editpro-electron-engineer
```

`agentx list` loads the package registry, then merges this directory's `agents.json` (and `access_profiles.json`) from the working tree. The walk starts at the current directory and stops at the nearest `.git` directory, so the command has to be run inside this repo. Entries with the same `id` or `name` replace the package defaults. If `agentx` is not on `PATH` after a user install, run `python -m agent_tools.cli` instead. The current package imports `requests` as soon as the CLI loads, and that dependency is not declared in its `pyproject.toml`, so install `requests` before the first `agentx` command.

## What agentx reads

Each object in `agents.json` needs the fields `AgentDefinition` loads:

| Field | Values |
|-------|--------|
| `id` | kebab-case, unique |
| `role` | short title |
| `description` | what the agent owns |
| `tags` | search terms |
| `capabilities` | kebab-case skills |
| `required_tools` | subset of the preferred profile's tools |
| `preferred_profile` | `safe`, `balanced`, or `power` |
| `risk_level` | `low`, `medium`, or `high` |

`workflow` and `success_criteria` are kept for people reading the registry. The CLI ignores them. `agentx check <id> --profile <name>` fails when `required_tools` is not covered by that profile.

Known tools are `read_file`, `list_dir`, `grep_search`, `semantic_search`, `apply_patch`, `create_file`, `run_in_terminal`, `github_repo`, and `runSubagent`.

## Agents defined here

| ID | Role | Profile |
|----|------|---------|
| editpro-orchestrator | Multi-Agent Orchestrator | power |
| editpro-photo-engine | Photo Engine Engineer | balanced |
| editpro-video-engine | Video Engine Engineer | balanced |
| editpro-electron-engineer | Electron / Desktop Engineer | power |
| editpro-ui-engineer | UI / React Engineer | balanced |
| editpro-test-engineer | Test Engineer | balanced |
| editpro-browser-test-engineer | Browser Test Engineer | balanced |
| editpro-release-engineer | Release & Packaging Engineer | power |
| editpro-security-engineer | Security Engineer | safe |
| editpro-cybersecurity-expert | Cybersecurity Expert | balanced |

Copilot custom agents for the video engine, browser testing, and security review live in [`.github/agents/`](../.github/agents/).

## Access profiles

See `access_profiles.json` for the three profiles used in EditPro:

- **safe** – read-only audit and analysis
- **balanced** – feature work inside the repo (write, no network)
- **power** – packaging, release orchestration, and cross-repo tools
