FROM node:20-slim

WORKDIR /app

# Copier les fichiers de dépendances
COPY package.json package-lock.json* ./

# Installer les dépendances
RUN npm install

# Copier le reste du code source
COPY . .

# Exposer le port du front (on utilise 3001 pour ne pas confliter avec Dagster)
EXPOSE 3001

# Lancer Next.js en mode dev sur le port 3001
CMD ["npm", "run", "dev", "--", "-p", "3001"]
