FROM nginx:latest
COPY default.conf /etc/nginx/conf.d/
COPY static /static/
RUN chown -R nginx:nginx /static
