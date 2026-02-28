# Odoo CRM Integration Module for Lead and Event Management

class OdooCRMIntegration:
    def __init__(self, url, db, username, password):
        self.url = url
        self.db = db
        self.username = username
        self.password = password
        self.common = None
        self.models = None
        self.session = self.authenticate()

    def authenticate(self):
        import xmlrpc.client
        common = xmlrpc.client.ServerProxy(f'{self.url}/xmlrpc/2/common')
        uid = common.authenticate(self.db, self.username, self.password, {})
        self.models = xmlrpc.client.ServerProxy(f'{self.url}/xmlrpc/2/object')
        return uid

    def create_lead(self, lead_data):
        lead_id = self.models.execute_kw(self.db, self.session, self.password,
            'crm.lead', 'create', [lead_data])
        return lead_id

    def update_lead(self, lead_id, lead_data):
        self.models.execute_kw(self.db, self.session, self.password,
            'crm.lead', 'write', [[lead_id], lead_data])

    def create_event(self, event_data):
        event_id = self.models.execute_kw(self.db, self.session, self.password,
            'calendar.event', 'create', [event_data])
        return event_id

    def update_event(self, event_id, event_data):
        self.models.execute_kw(self.db, self.session, self.password,
            'calendar.event', 'write', [[event_id], event_data])

# Usage example
# odoo = OdooCRMIntegration('http://your-odoo-url', 'your-db-name', 'your-username', 'your-password')
# lead_id = odoo.create_lead({'name': 'New Lead', 'email_from': 'email@example.com'})
# odoo.update_lead(lead_id, {'stage_id': new_stage_id})
# event_id = odoo.create_event({'name': 'New Event', 'start': start_datetime, 'stop': end_datetime})
# odoo.update_event(event_id, {'attendee_ids': [(4, attendee_id)]})