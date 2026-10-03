# Laravel API image (php-fpm). Build context: this directory.
FROM composer:2 AS vendor
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction
COPY . .
RUN composer dump-autoload --optimize --no-dev

FROM php:8.3-fpm-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends default-mysql-client libzip-dev unzip \
 && docker-php-ext-install pdo_mysql bcmath opcache zip \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /var/www/html
COPY --from=vendor /app /var/www/html
RUN chown -R www-data:www-data storage bootstrap/cache
USER www-data
EXPOSE 9000
CMD ["php-fpm"]
