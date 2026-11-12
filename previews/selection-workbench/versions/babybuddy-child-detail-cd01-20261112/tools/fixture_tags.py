"""Fixture-only adapters. No original model/database/server is imported or executed."""
from datetime import datetime
from django import template
from django.template import Context
from django.utils.timesince import timesince as django_timesince

register = template.Library()
FIXTURE = {}

@register.filter(name='timesince')
def fixed_timesince(value):
    # A DateField is converted to naive local midnight by Django timesince.
    # Our explicitly fixed UTC local clock must have the same awareness.
    local_now = datetime.fromisoformat(FIXTURE['as_of']).replace(tzinfo=None)
    return django_timesince(value, local_now)

@register.simple_tag(takes_context=True)
def timer_nav(context):
    values = {**context.flatten(), 'timers': FIXTURE['timers']}
    return context.template.engine.get_template('core/timer_nav.html').render(Context(values))
