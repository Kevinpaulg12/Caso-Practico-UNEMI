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

## Pruebas

```
cd backend && python manage.py test --settings=core.settings_test
cd frontend && npm test
```

Las pruebas del backend usan SQLite en memoria y no tocan ninguna base real.
