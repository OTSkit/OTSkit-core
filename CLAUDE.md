# CLAUDE.md — OTSkit

> Respuestas en castellano, cortas y directas. Sin preamble ni resúmenes al final.

---

## CONTEXTO

Monorepo de tres paquetes npm bajo la organización `@otskit`:

| Repo | Paquete | Versión actual |
|------|---------|---------------|
| `OTSkit-core` | `@otskit/core` | 0.1.x |
| `OTSkit-client` | `@otskit/client` | 0.1.x |
| `OTSkit-MCP` | `@otskit/mcp` | 0.1.x |

Todos están en fase de desarrollo activo (`0.x`). No usar `1.x` hasta decisión explícita del usuario.

---

## REGLA 1 — VERSIONADO

- Todos los paquetes siguen `0.x.x` hasta que el usuario decida subir a `1.0.0`
- **Nunca tocar `version` en `package.json` manualmente** — lo gestiona semantic-release automáticamente
- Si semantic-release crea un tag `v1.x` por error: avisar al usuario inmediatamente, no publicar

---

## REGLA 2 — SEMANTIC-RELEASE Y CI

Las releases en npm las gestiona semantic-release automáticamente al hacer push a `main`.
Solo se dispara con commits `fix:` o `feat:`. Los demás (`docs:`, `ci:`, `chore:`, `refactor:`) no crean release.

**Antes de activar semantic-release en un repo nuevo:**
1. Asegurarse de que el secret `NPM_TOKEN` está en GitHub Actions del repo
2. Crear el tag inicial manualmente: `git tag v0.x.x HEAD && git push origin v0.x.x`
3. Sin esas dos cosas, semantic-release publicará `v1.0.0` por defecto — error conocido

---

## REGLA 3 — CONVENTIONAL COMMITS

```
feat: nueva funcionalidad        → minor release (0.1.0 → 0.2.0)
fix: corrección de bug           → patch release (0.1.0 → 0.1.1)
docs: solo documentación         → sin release
ci: cambios en CI/CD             → sin release
chore: tareas de mantenimiento   → sin release
refactor: sin cambio de API      → sin release
BREAKING CHANGE:                 → major release (0.1.0 → 1.0.0) — solo con autorización del usuario
```

---

## REGLA 4 — GIT

```bash
# Rama principal: main (nunca master)
# Añadir ficheros específicos, nunca git add . ni git add -A
rtk git add ruta/al/fichero

# Formato de commit
git commit -m "tipo: descripción concisa

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

> **PROHIBIDO hacer `git push` sin autorización explícita del usuario.**

---

## REGLA 5 — NPM Y TOKENS

- **Nunca pedir un token npm al usuario en el chat** — son credenciales sensibles
- Si se necesita publicar manualmente, indicar al usuario que ejecute el comando él mismo con `! npm publish`
- Los tokens van siempre en GitHub Secrets (`NPM_TOKEN`), nunca hardcodeados ni en variables de entorno locales

---

## REGLA 6 — DEPENDENCIAS ENTRE PAQUETES

En los `package.json` publicados, `@otskit/core` siempre referenciado desde el registro npm:
```json
"@otskit/core": "^0.1.0"
```
**Nunca** usar `"file:../otskit-core"` en un paquete publicado — rompe la instalación para usuarios externos.

---

## REGLA 7 — ANTES DE CUALQUIER CAMBIO NO TRIVIAL

1. Leer el código actual del fichero a tocar
2. Comprobar que el build pasa: `npm run build` (o `pnpm build` en MCP)
3. Comprobar que los tests pasan: `npm test`
4. Hacer el cambio
5. Verificar build y tests de nuevo antes de commitear
