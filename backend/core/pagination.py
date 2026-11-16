from rest_framework.pagination import PageNumberPagination


class StandardPagination(PageNumberPagination):
    """10 por página por defecto; quien necesita todo el historial pide páginas de hasta 100."""
    page_size = 10
    page_size_query_param = 'page_size'
    max_page_size = 100
