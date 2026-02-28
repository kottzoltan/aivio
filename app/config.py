# Cloud Run environment variables configuration

import os

# Odoo configuration
ODOO_URL = os.environ.get('ODOO_URL')
ODOO_DB = os.environ.get('ODOO_DB')
ODOO_USERNAME = os.environ.get('ODOO_USERNAME')
ODOO_PASSWORD = os.environ.get('ODOO_PASSWORD')

# Zadarma configuration
ZADARMA_API_KEY = os.environ.get('ZADARMA_API_KEY')
ZADARMA_LOGIN = os.environ.get('ZADARMA_LOGIN')
ZADARMA_PASSWORD = os.environ.get('ZADARMA_PASSWORD')

# Asterisk configuration
ASTERISK_SERVER = os.environ.get('ASTERISK_SERVER')
ASTERISK_USERNAME = os.environ.get('ASTERISK_USERNAME')
ASTERISK_PASSWORD = os.environ.get('ASTERISK_PASSWORD')