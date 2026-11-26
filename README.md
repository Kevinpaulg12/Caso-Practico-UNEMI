# DentalSense AI

Seguimiento postoperatorio odontológico: Django REST Framework (`backend/`) y React con Vite (`frontend/`).

## Puesta en marcha

Con Docker (aplica las migraciones al arrancar):

```
docker compose up --build
```

Sin Docker, con Python 3.12 o 3.13 y PostgreSQL:

```
cp .env.example .env     # con DEBUG=False, SECRET_KEY es obligatoria
cd backend
python -m pip install -r requirements.txt
python -m spacy download es_core_news_sm
python manage.py migrate
python manage.py runserver

cd frontend
npm install
npm run dev
```

`python manage.py seed_demo` crea datos de demostración **borrando los existentes**; solo se ejecuta con `DEBUG=True` o con `--force`.

## Variantes del producto

DentalSense es una línea de productos con dos variantes, definidas en `backend/core/config_product.py`:

| Variante | Informes (`clinical_reports`) | Notificaciones (`notifications`) | IA generativa |
|---|---|---|---|
| A · DentalSense Básico | No | No | No |
| B · DentalSense Completo | Sí | Sí | Sí (con `GEMINI_API_KEY`) |

Se elige con `PRODUCT_VARIANT` (por defecto `B`):

```
PRODUCT_VARIANT=A docker compose up --build
```

Cada característica puede activarse o desactivarse por separado con `ENABLE_REPORTS`, `ENABLE_NOTIFICATIONS` o `ENABLE_AI`. El manual completo está en `docs/linea-de-productos.md`.

## Pruebas

```
cd backend && python manage.py test --settings=core.settings_test
cd frontend && npm test
```

Las pruebas del backend usan SQLite en memoria y no tocan ninguna base real.
