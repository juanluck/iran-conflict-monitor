# Monitor energético y de consumo — conflicto con Irán

Web estática, lista para GitHub Pages que reúne datos públicos y actualizados sobre:

- crudo Brent y WTI
- reservas petrolíferas en España y UE
- precios de carburantes en España
- precios semanales de carburantes en la UE
- proxy de energía y "lista de la compra" mediante HICP Eurostat
- mapa AIS embebido de VesselFinder centrado en el Estrecho de Ormuz

## Qué incluye

- `index.html`: estructura principal de la web
- `styles.css`: estilos
- `app.js`: renderizado de KPIs, gráficas y referencias
- `scripts/fetch-data.mjs`: script Node que consulta APIs/ficheros públicos y genera `data/latest.json`
- `.github/workflows/update-data.yml`: actualización automática cada 6 horas y en cada push a `main`
- `package.json`: dependencias y script de actualización
- `data/latest.json`: placeholder inicial para evitar errores 404 antes del primer refresco

## Fuentes utilizadas

1. EIA Open Data API
2. Eurostat API y datasets `nrg_stk_oem` y `prc_hicp_midx`
3. MITECO / Geoportal de Hidrocarburos
4. Comisión Europea — Weekly Oil Bulletin
5. VesselFinder Embed

## Despliegue en GitHub

1. Crea un repositorio nuevo en GitHub.
2. Sube el contenido de esta carpeta al repositorio.
3. En GitHub, ve a **Settings → Secrets and variables → Actions**.
4. Crea un secreto de repositorio llamado `EIA_API_KEY` y pega ahí tu clave de la EIA.
5. Ve a **Actions** y ejecuta manualmente el workflow **Actualizar datos** una vez.
6. Ve a **Settings → Pages** y publica desde la rama `main` y la carpeta raíz (`/root`).

## Importante sobre la clave de EIA

No publiques la clave en `app.js`, `index.html` ni en el repositorio. Esta plantilla está hecha para que la clave se use solo en GitHub Actions y el front lea el JSON ya generado.

## Desarrollo local

```bash
npm install
EIA_API_KEY=tu_clave npm run update-data
python3 -m http.server 8000
```

Luego abre `http://localhost:8000`.
