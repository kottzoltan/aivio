# ---- Node 18 (Cloud Run kompatibilis)
FROM node:18-alpine

# ---- App könyvtár
WORKDIR /app

# ---- Csomagok
COPY package*.json ./
RUN npm install --production

# ---- Backend kód
COPY index.js ./

# ---- UI KÖTELEZŐEN!
COPY ui ./ui

# ---- Port
ENV PORT=8080
EXPOSE 8080

# ---- Start
CMD ["node", "index.js"]
