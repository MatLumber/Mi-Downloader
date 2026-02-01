# GravityDown

High-Performance Media Extractor. GravityDown is a modern desktop application for downloading media, built with Electron, React, and a powerful Python backend.

## Features

- **High Performance**: Optimized for speed and efficiency.
- **Modern UI**: Sleek interface built with React, TailwindCSS, and Framer Motion.
- **Media Support**: Download videos, audio, and images from various sources using `yt-dlp`.
- **Cross-Platform**: Designed for Windows (Portable & Installer).

## Tech Stack

### Frontend
- **Electron**: Desktop runtime.
- **React**: UI library.
- **Vite**: Build tool.
- **TypeScript**: Type safety.
- **TailwindCSS**: Styling.
- **Zustand**: State management.
- **Framer Motion**: Animations.

### Backend
- **Python**: Core logic.
- **FastAPI**: API server.
- **yt-dlp**: Media extraction engine.
- **Uvicorn**: ASGI server.

## Development Setup

### Prerequisites
- Node.js (v18+ recommended)
- Python (v3.10+ recommended)

### 1. Backend Setup

The Electron development server expects a Python virtual environment at `backend/venv`.

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
.\venv\Scripts\activate
# Linux/Mac:
# source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Frontend & App Launch

```bash
cd frontend

# Install dependencies
npm install

# Run development mode (starts Vite + Electron + Python backend)
npm run electron:dev
```

## Building for Production

To build the application for distribution:

```bash
cd frontend
npm run electron:build
```

The output will be in `frontend/release`.

## Project Structure

- `frontend/`: Electron main process and React renderer.
- `backend/`: Python server and media handling logic.
- `dist/`: Shared build artifacts.

## License

Private / Proprietary
