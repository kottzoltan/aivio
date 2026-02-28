# Deploy Cloud UI nélkül (gcloud)

## Előfeltétel

- `gcloud` CLI telepítve, bejelentkezve: `gcloud auth login`
- Projekt kiválasztva: `gcloud config set project PROJEKT_ID`
- Cloud Run API + (opcionálisan) Cloud Build API engedélyezve

## 1. Egy parancs: build + deploy (Cloud Build + Cloud Run)

A forráskódból épít és azonnal deployol (Cloud Build automatikus):

```bash
# Staging szolgáltatás, aktuális mappából
gcloud run deploy aivio-staging \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated

# Ha a staging a dev branchről épül, előbb:
git checkout dev
gcloud run deploy aivio-staging --source . --region europe-west1 --allow-unauthenticated
```

## 2. Két lépés: előbb image, aztán deploy

Ha saját registry-t használsz (Artifact Registry):

```bash
# Image építése (Cloud Build)
gcloud builds submit --tag europe-west1-docker.pkg.dev/PROJEKT_ID/aivio/aivio:latest .

# Deploy
gcloud run deploy aivio-staging \
  --image europe-west1-docker.pkg.dev/PROJEKT_ID/aivio/aivio:latest \
  --region europe-west1 \
  --allow-unauthenticated
```

Előtte hozd létre a repót (egyszer):

```bash
gcloud artifacts repositories create aivio \
  --repository-format=docker \
  --location=europe-west1
```

## Env / Secret Manager

Ha a titkok a Secret Manager-ben vannak, a service accountnak kell a **Secret Manager Secret Accessor** role.  
Env változókat deploykor is megadhatsz:

```bash
gcloud run deploy aivio-staging --source . --region europe-west1 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=PROJEKT_ID"
```

Secret Manager secretet env-ként (ajánlott):

```bash
gcloud run deploy aivio-staging --source . --region europe-west1 \
  --set-secrets "OPENAI_API_KEY=OPENAI_API_KEY:latest,ODOO_URL=ODOO_URL:latest"
```

## Rövid összefoglaló

| Cél            | Parancs |
|----------------|--------|
| Staging deploy | `gcloud run deploy aivio-staging --source . --region europe-west1 --allow-unauthenticated` |
| Projekt        | `gcloud config set project PROJEKT_ID` |
| Régió lista    | `gcloud run regions list` |
