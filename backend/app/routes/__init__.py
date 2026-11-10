from flask import Flask


def register_blueprints(app: Flask) -> None:
    from .auth import bp as auth
    from .customers import bp as customers
    from .inventory import bp as inventory
    from .orders import bp as orders
    from .printing import agent_bp, bp as printing
    from .reports import bp as reports
    from .settings import bp as settings

    for blueprint in (auth, customers, inventory, orders, printing, agent_bp, reports, settings):
        app.register_blueprint(blueprint)
