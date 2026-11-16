# backend/Dockerfile

# Usamos 'slim' en lugar de 'alpine' para Python. 
# Alpine causa dolores de cabeza al compilar ruedas (wheels) de C para Postgres o Pandas.
FROM python:3.12-slim

# Variables de entorno críticas para Python
ENV PYTHONDONTWRITEBYTECODE=1 
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Instalamos dependencias del sistema necesarias para compilar y herramientas de red
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libpq-dev \
    && apt-get clean

# Optimizamos el caché de Docker copiando solo requirements.txt primero
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt
RUN python -m spacy download es_core_news_sm
# El código se montará vía volumen en desarrollo, pero copiamos por buena práctica
COPY . .

# Exponemos el puerto
EXPOSE 8000