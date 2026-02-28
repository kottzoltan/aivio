import requests

class ZadarmaIntegration:
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = 'https://api.zadarma.com/v1/'

    def make_call(self, phone_number):
        url = f'{self.base_url}call/'
        data = {'caller': 'your_caller_id', 'receiver': phone_number}
        response = requests.post(url, json=data, headers=self._get_headers())
        return response.json()

    def send_sms(self, phone_number, message):
        url = f'{self.base_url}sms/'
        data = {'phones': phone_number, 'text': message}
        response = requests.post(url, json=data, headers=self._get_headers())
        return response.json()

    def _get_headers(self):
        return {'Authorization': f'Bearer {self.api_key}', 'Content-Type': 'application/json'}
