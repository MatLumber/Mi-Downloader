# GravityDown

Descargador y procesador de medios para Windows. Electron + React en el frente, un motor Python (yt-dlp + ffmpeg) por debajo.

## Para usuarios

**No hay que instalar nada más.** Python, yt-dlp, ffmpeg y ffprobe van dentro de la app. Descarga el instalador de la [última release](https://github.com/MatLumber/Mi-Downloader/releases/latest) y ábrela:

- `GravityDown-Setup-x.y.z.exe` — instalador (no requiere permisos de administrador).
- `GravityDown-x.y.z.exe` — versión portable.

### Actualizaciones

Automáticas. La app comprueba GitHub Releases al arrancar, descarga la nueva versión en segundo plano y la instala al cerrar. Los ajustes y el historial se conservan entre versiones.

Además se publica una versión nueva cada vez que yt-dlp saca una release. Esto no es cosmético: yt-dlp va congelado dentro del motor, y YouTube cambia su reproductor con frecuencia — una copia de hace semanas empieza a fallar sola aunque no toques nada.

### Si algo falta

Al arrancar, la app comprueba que estén el motor y ffmpeg. Si falta alguno — casi siempre porque el antivirus puso en cuarentena el ejecutable, que no está firmado — lo vuelve a descargar automáticamente y verifica su SHA-256 antes de usarlo. Verás el progreso en la barra superior.

Si aun así falla: **Ajustes → Motor** muestra el estado, permite reiniciarlo y abre el log. Lo más eficaz suele ser añadir una excepción en el antivirus para la carpeta de instalación.

### Extensión Companion (opcional)

Sirve para descargar contenido que requiere sesión iniciada en YouTube. Chrome 127+ cifra sus cookies de forma que yt-dlp no puede leerlas; la extensión las lee vía `chrome.cookies` y las envía a la app local. Se exporta desde **Ajustes → Cookies** y se carga como extensión descomprimida en `chrome://extensions`.

Si actualizas GravityDown, vuelve a exportar la extensión de vez en cuando: al cargarse descomprimida, no se actualiza sola.

## Para desarrollar

### Requisitos

- Node.js 20+
- Python 3.11+

### Puesta en marcha

```bash
# Motor
cd backend
python -m venv venv
./venv/Scripts/python.exe -m pip install -r requirements.txt

# App
cd ../frontend
npm install
npm run electron:dev      # Vite + Electron + motor
```

### Compilar el instalador

```bash
./build.bat               # desde la raíz
```

Comprueba el toolchain, compila el motor con PyInstaller, lo arranca para verificar que responde, compila el renderer y genera los instaladores en `frontend/release/`.

Necesita `backend/ffmpeg/ffmpeg.exe` y `ffprobe.exe` (build "release essentials" de [gyan.dev](https://www.gyan.dev/ffmpeg/builds/)). CI los descarga automáticamente.

### Arquitectura

| Capa | Ruta | Qué hace |
|------|------|----------|
| Renderer | `frontend/src/` | React 19, Zustand, Tailwind v4 |
| Electron | `frontend/electron/` | Ciclo de vida, supervisión del motor, auto-reparación, updates |
| Motor | `backend/` | FastAPI + yt-dlp + ffmpeg, en loopback |

El motor toma el primer puerto libre entre 8765 y 8788 y lo publica en `%LOCALAPPDATA%\GravityDown\backend-endpoint.json`. Ningún componente asume un puerto fijo.

Detalles de diseño, invariantes y qué no se puede cambiar sin romper a los usuarios existentes: [`CLAUDE.md`](./CLAUDE.md).

### Releases

Todo push a `master` incrementa el patch, etiqueta y publica. La build vive en `.github/workflows/build-release.yml` (workflow reutilizable); `auto-tag.yml`, `release.yml` y `ytdlp-refresh.yml` la invocan.

## Licencia

Privado / Propietario
