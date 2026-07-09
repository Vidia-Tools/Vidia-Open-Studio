# Vendored mirror of Vidia-Open-Studio-Nodes

This directory is a static mirror of https://codeberg.org/Vidia-Tools/Vidia-Open-Studio-Nodes

- Hosted RunPod pods do NOT use this copy: `worker/src/start.sh` clones the
  live Nodes repo at boot (see the vidia-open-studio-node install section).
- Local mode uses this vendored copy.
- Any node changes must be made in the Nodes repo first, then synced here.
  Editing only this mirror will silently drift from what hosted pods run.
