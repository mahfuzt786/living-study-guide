# Living Study Guide: a small, self-contained image.
#   docker build -t living-study-guide .
#   docker run -d -p 8080:8080 -v study-data:/app/data -e ANTHROPIC_API_KEY=... living-study-guide

# --- production dependencies (vendor/) ---
FROM php:8.2-cli-alpine AS build
RUN apk add --no-cache unzip
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /app
COPY composer.json composer.lock ./
COPY src/ src/
RUN composer install --no-dev --no-interaction --no-progress --prefer-dist --optimize-autoloader

# --- runtime ---
# The official PHP image already includes the curl, mbstring and pdo_sqlite extensions.
FROM php:8.2-cli-alpine
WORKDIR /app
COPY --from=build /app/vendor/ vendor/
COPY . .
RUN mkdir -p /app/data && chown -R www-data:www-data /app/data

# The database lives in /app/data: mount a volume there so it survives new deployments.
# Several server workers let other pages load while a long Claude request is running.
ENV STUDY_DATA_DIR=/app/data \
    PHP_CLI_SERVER_WORKERS=4
VOLUME ["/app/data"]
USER www-data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/login.php || exit 1
CMD ["php", "-S", "0.0.0.0:8080", "-t", "public"]
