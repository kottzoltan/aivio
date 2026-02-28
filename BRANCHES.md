# Branch workflow

| Fázis         | Branch      | Cél                          |
|---------------|-------------|------------------------------|
| **Cursor**    | `exp/cursor`| Fejlesztés Cursor-ban         |
| **Merge**     | `dev`       | exp/cursor → dev (PR/merge)   |
| **Cloud Build** | staging   | dev → build → staging deploy  |

## Gyors parancsok

```bash
# Cursor munka: push exp-cursor → origin/exp/cursor
git push origin exp-cursor:exp/cursor

# Merge: dev-be merge (PR preferált)
git checkout dev && git pull && git merge exp-cursor && git push origin dev
```
