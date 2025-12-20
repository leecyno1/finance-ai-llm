# Update Dr.Lemon to the latest version

To update Dr.Lemon to the latest version, follow these steps:

## For Docker users (Using pre-built images)

Simply pull the latest image and restart your container:

```bash
docker pull ghcr.io/leecyno1/finance-ai-llm:full-latest
docker stop dr-lemon || true
docker rm dr-lemon || true
docker run -d -p 3000:3000 \
  -e SEARXNG_API_URL=http://localhost:8080 \
  -v dr-lemon-data:/home/perplexica/data \
  -v dr-lemon-uploads:/home/perplexica/uploads \
  --name dr-lemon \
  ghcr.io/leecyno1/finance-ai-llm:full-latest
```

Once updated, go to http://localhost:3000 and verify the latest changes. Your settings are preserved automatically.

## For Docker users (Building from source)

1. Navigate to your project directory and pull the latest changes:

   ```bash
   git pull
   ```

2. Rebuild the Docker image:

   ```bash
   docker build -t dr-lemon .
   ```

3. Stop and remove the old container, then start the new one:

   ```bash
   docker stop dr-lemon || true
   docker rm dr-lemon || true
   docker run -p 3000:3000 -p 8080:8080 --name dr-lemon dr-lemon
   ```

4. Once the command completes, go to http://localhost:3000 and verify the latest changes.

## For non-Docker users

1. Navigate to your project directory and pull the latest changes:

   ```bash
   git pull
   ```

2. Install any new dependencies:

   ```bash
   npm i
   ```

3. Rebuild the application:

   ```bash
   npm run build
   ```

4. Restart the application:

   ```bash
   npm run start
   ```

5. Go to http://localhost:3000 and verify the latest changes. Your settings are preserved automatically.

---
