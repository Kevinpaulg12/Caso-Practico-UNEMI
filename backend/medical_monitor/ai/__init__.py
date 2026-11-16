"""Capa de IA generativa: asistente conversacional, resumen clínico y explicación de indicaciones.

Principios (defendidos en la tesis):
- El triaje (verde, amarillo, rojo) lo decide siempre el motor local de PLN y reglas; el LLM nunca
  lo cambia.
- Al LLM solo llegan datos anonimizados (ver anonymize.py).
- Si el LLM no está disponible, cada función tiene una alternativa local determinista.
"""
