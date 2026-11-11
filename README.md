<br />

<h1 align="center">omp-rename-workspace</h1>

<p align="center"><strong>Name your Paseo or Herdr workspace after what omp is working on</strong></p>

<br />

After the first turn, an unnamed workspace gets a short name from the conversation. `/rename-workspace` renames it on demand.

```text
❯ We're fixing the seed data loader (ENR-950)
ok
herdr-app workspace: SEED: Seed loader · ENR-950
```

## Install

Requires omp 18.12+, and one of Paseo, herdr-app, or [Herdr](https://herdr.dev).

```sh
omp plugin install github:rstacruz/omp-rename-workspace
```

Restart omp after installing.

## Usage

- **Auto:** after the first turn of a session, if the workspace still has its automatic name, it gets named. One try per session; a workspace someone already named is left alone.
- **`/rename-workspace [hint]`:** name it now, even if it already has a name. The hint steers the name (`/rename-workspace call it LOADER`). The omp session, terminal title, and (in herdr-app) the tab get the same name.

Names look like `CODE: Title · ABC-123`, at most 33 characters. A side turn (like `/btw`) picks the name, so nothing is added to the conversation.

## Hosts

| Host | Detected by | Counts as unnamed when |
| --- | --- | --- |
| Paseo | `PASEO_WORKSPACE_ID` | the name is the branch or folder name |
| herdr-app | `HC_TERMINAL_ID` and `herdr-app` in `PATH` | the space has no stored name |
| Herdr | `HERDR_WORKSPACE_ID` | the label is the repo or folder name |

Checked in that order. Set `PASEO_CLI` to use another `paseo` binary.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `OMP_RENAME_WORKSPACE_AUTO` | `1` | `0` turns off auto-naming; `/rename-workspace` still works |

## Development

```sh
bun install
bun run check
omp plugin link .
```
