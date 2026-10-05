# Project Architecture & File Organization Rules

Strictly follow this directory structure and modularization logic for all created or modified files.

## JavaScript Organization (`./js/`)
All JavaScript files must be properly split into small, single-responsibility modules. Do not write monolithic scripts. Place files strictly into the following subdirectories:

- `./js/ui/` — User interface logic, DOM manipulations, UI components, and event listeners.
- `./js/business/` — Core business logic, functional processes, and domain algorithms.
- `./js/class/` — Class definitions, object structures, and reusable OOP components.
- `./js/model/` — Data management, state, persistence (cookies, LocalStorage, SessionStorage), and API models.

## Stylesheet Organization (`./css/`)
- All CSS files must be placed in `./css/`.
- Styles must be split into dedicated files based on feature or scope (e.g., `./css/navigation.css`, `./css/badge.css`, `./css/modal.css`). Do not bundle all styles into a single file.

## Media & Asset Organization (`./assets/`)
Assets must follow a strictly typed and feature-oriented structure:
- Base path format: `./assets/<media_type>/<feature>/<filename>`
- Valid `<media_type>` directories: `img/`, `sounds/`, `video/`, etc.
- Always create a subfolder named after the relevant feature inside the media type folder.

### Examples:
- Badge icon image: `./assets/img/badge/icon.png`
- Notification sound: `./assets/sounds/notification/alert.mp3`
- Hero background video: `./assets/video/landing/hero.mp4`