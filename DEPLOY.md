# Deploy Cloud UI nélkül (gcloud)

- **Projekt:** `aivio-486419`
- **Régió:** `europe-central2`
- **URL:** https://aivio-staging-592551502751.europe-central2.run.app

## Előfeltétel

- `gcloud` CLI telepítve, bejelentkezve: `gcloud auth login`
- Projekt: `gcloud config set project aivio-486419`
- Cloud Run API + (opcionálisan) Cloud Build API engedélyezve

## 1. Egy parancs: build + deploy (Cloud Build + Cloud Run)

A forráskódból épít és azonnal deployol (Cloud Build automatikus):

```bash
gcloud config set project aivio-486419
gcloud run deploy aivio-staging \
  --source . \
  --region europe-central2 \
  --allow-unauthenticated
```

## 2. Két lépés: előbb image, aztán deploy

Ha saját registry-t használsz (Artifact Registry):

```bash
# Image építése (Cloud Build)
gcloud builds submit --tag europe-central2-docker.pkg.dev/aivio-486419/aivio/aivio:latest .

# Deploy
gcloud run deploy aivio-staging \
  --image europe-central2-docker.pkg.dev/aivio-486419/aivio/aivio:latest \
  --region europe-central2 \
  --allow-unauthenticated
```

Előtte hozd létre a repót (egyszer):

```bash
gcloud artifacts repositories create aivio \
  --repository-format=docker \
  --location=europe-central2
```

## Env / Secret Manager

Ha a titkok a Secret Manager-ben vannak, a service accountnak kell a **Secret Manager Secret Accessor** role.  
Env változókat deploykor is megadhatsz:

```bash
gcloud run deploy aivio-staging --source . --region europe-central2 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=aivio-486419"
```

Secret Manager secretet env-ként (ajánlott):

```bash
gcloud run deploy aivio-staging --source . --region europe-central2 \
  --set-secrets "OPENAI_API_KEY=OPENAI_API_KEY:latest,ODOO_URL=ODOO_URL:latest"
```

## Rövid összefoglaló

| Cél            | Parancs |
|----------------|--------|
| Staging deploy | `gcloud run deploy aivio-staging --source . --region europe-central2 --allow-unauthenticated` |
| Projekt        | `gcloud config set project aivio-486419` |
| Régió lista    | `gcloud run regions list` |
