# @waterford/waf-harness-cli

The WAF Harness command line. Installs the `wafh` command: an interactive REPL, a one-shot task runner, model / vault configuration, and the launcher for the Web service.

```bash
npm install -g @waterford/waf-harness-cli   # requires Node >= 24
```

```bash
wafh web        # start the Web service and open http://127.0.0.1:7364
wafh server     # same service, headless

wafh config model add --model-id deepseek-v4-pro --api-key sk-... --set-default

wafh run -m "Create hello.txt containing Hello, WAF Harness"    # one Task, then exit
wafh chat                                                   # REPL: /compact, /clear, /exit, Ctrl-C interrupts
wafh chat --resume                                          # resume the latest session
```

Tool calls go through an approval gate — `--approve allow-all` (default) `| deny-all | read-only | always-ask`. Data lives under `~/.waf-harness/data` (`WAFH_HOME` or `--root` override); model credentials come from the Project config or provider env vars (e.g. `DEEPSEEK_API_KEY`).

Prefer a one-line install with a bundled Node runtime? See [Quickstart → CLI and Web App](https://penguin.ooo/docs/quickstart-cli).

## Documentation

- [Quickstart](https://penguin.ooo/docs/quickstart)
- [CLI Reference](https://penguin.ooo/docs/cli)
- [Configuration Reference](https://penguin.ooo/docs/configuration)

## Development

```bash
pnpm wafh <args>                              # run from source (repo root, via tsx)
pnpm --filter @waterford/waf-harness-cli build     # tsup → dist/index.js (the wafh bin)
pnpm --filter @waterford/waf-harness-cli typecheck
pnpm --filter @waterford/waf-harness-cli test
```

Part of [WAF Harness](https://github.com/Prism-Shadow/penguin-harness) · Apache-2.0
