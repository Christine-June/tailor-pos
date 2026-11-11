from flask import Flask


def register_blueprints(app: Flask) -> None:
    from .auth import bp as auth, meta_bp
    from .customers import bp as customers
    from .inventory import bp as inventory
    from .orders import bp as orders
    from .printing import agent_bp, bp as printing
    from .reports import bp as reports
    from .settings import bp as settings
    from ..monitoring import bp as client_errors

    for blueprint in (auth, meta_bp, customers, inventory, orders, printing, agent_bp, reports, settings, client_errors):
        app.register_blueprint(blueprint)
