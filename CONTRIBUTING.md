# Contributing to Vidia Open Studio

Thanks for your interest in contributing.

## Setup

- Hosted mode (Cloudflare + RunPod): see [DEPLOY.md](DEPLOY.md)
- Local mode (your own GPU): see [worker/README.md](worker/README.md)

## Coding conventions

- Match the existing style of the file you are editing. Do not reformat
  surrounding code.
- Do not run npm builds inside the repo. Frontend builds are validated in
  temporary directories outside the repository; keep `node_modules` and build
  output out of the tree.
- Keep changes minimal and focused. One concern per pull request.

## Branches and pull requests

1. Fork the repo on GitHub and create a branch from `main`.
2. Make your changes and test them (local mode is the quickest way).
3. Open a pull request against `main`. Fill in the PR template, including
   what you tested.
4. A maintainer will review. Small, well-described PRs get merged fastest.

## Contributor license agreement

By submitting a contribution to this repository, you agree that your
contribution is licensed under the project license (FSL-1.1-Apache-2.0, see
[LICENSE.md](LICENSE.md)), and you grant the maintainer the right to
relicense your contribution, including in commercial licenses.
