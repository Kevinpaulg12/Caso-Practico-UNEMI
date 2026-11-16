# frontend/Dockerfile

FROM node:20-alpine

WORKDIR /app

# Copiamos solo los archivos de dependencias primero para aprovechar la caché de capas de Docker
COPY package*.json ./

RUN npm install

# Copiamos el resto del código
COPY . .

EXPOSE 5173 