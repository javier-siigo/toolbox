-- Nueva opción "Registrar" para el campo falta de gestión de anticipos.

alter type anticipos.falta add value if not exists 'registrar';
