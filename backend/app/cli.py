"""Operator commands: `flask create-shop` provisions a tenant; `flask seed-demo` loads sample data."""
from decimal import Decimal

import click
from flask import Flask, current_app
from sqlalchemy import select

from .extensions import db
from .models import Customer, InventoryItem, ItemKind, Measurement, MovementReason, Shop, User, UserRole
from .schemas import normalize_phone
from .services.stock import apply_movement


def register_cli(app: Flask) -> None:
    @app.cli.command("create-shop")
    @click.option("--name", prompt="Shop name")
    @click.option("--owner-name", prompt="Owner's name")
    @click.option("--email", prompt="Owner's email")
    @click.option("--password", prompt=True, hide_input=True, confirmation_prompt=True)
    def create_shop(name, owner_name, email, password):
        """Create a shop and its owner account."""
        email = email.strip().lower()
        if len(password) < 8:
            raise click.ClickException("Password must be at least 8 characters")
        if db.session.scalar(select(User.id).where(User.email == email)):
            raise click.ClickException(f"{email} is already registered")
        shop = Shop(name=name)
        db.session.add(shop)
        db.session.flush()
        owner = User(shop_id=shop.id, name=owner_name, email=email, role=UserRole.OWNER)
        owner.set_password(password)
        db.session.add(owner)
        db.session.commit()
        click.echo(f"Created {name}. Sign in as {email}.")

    @app.cli.command("seed-demo")
    def seed_demo():
        """Create a demo shop with sample data. Refuses to run in production."""
        if current_app.config["APP_ENV"] == "production":
            raise click.ClickException("seed-demo is disabled in production")
        if db.session.scalar(select(User.id).where(User.email == "owner@demo.test")):
            click.echo("Demo data already present.")
            return
        shop = Shop(name="Demo Tailoring Studio", address="Kimathi Street, Nairobi", phone="0712 345 678",
                    receipt_footer="Thank you. Please bring this receipt when collecting.", min_deposit_pct=Decimal("30"))
        db.session.add(shop)
        db.session.flush()

        staff = {}
        for name, email, role in (
            ("Demo Owner", "owner@demo.test", UserRole.OWNER),
            ("Demo Cashier", "cashier@demo.test", UserRole.CASHIER),
            ("Demo Tailor", "tailor@demo.test", UserRole.TAILOR),
        ):
            user = User(shop_id=shop.id, name=name, email=email, role=role)
            user.set_password("demo-password")
            db.session.add(user)
            staff[role] = user
        db.session.flush()

        catalogue = [
            ("Italian wool suiting", ItemKind.FABRIC, "Fabric", "m", "3500", "2100", "42.5", "10"),
            ("Linen, natural", ItemKind.FABRIC, "Fabric", "m", "1800", "950", "30", "8"),
            ("Kitenge wax print", ItemKind.FABRIC, "Fabric", "m", "950", "500", "6.25", "10"),
            ("Silk lining", ItemKind.FABRIC, "Fabric", "m", "1200", "700", "25", "5"),
            ("Horn buttons (set)", ItemKind.TRIM, "Trims", "set", "450", "200", "40", "10"),
            ("Invisible zip", ItemKind.TRIM, "Trims", "pcs", "120", "50", "85", "20"),
            ("Silk tie", ItemKind.RETAIL, "Accessories", "pcs", "1500", "700", "24", "5"),
            ("Cotton dress shirt", ItemKind.RETAIL, "Ready-to-wear", "pcs", "3200", "1800", "18", "5"),
            ("Leather belt", ItemKind.RETAIL, "Accessories", "pcs", "2200", "1100", "3", "5"),
            ("Two-piece suit, labour", ItemKind.SERVICE, "Tailoring", "job", "15000", "0", "0", "0"),
            ("Dress, labour", ItemKind.SERVICE, "Tailoring", "job", "8000", "0", "0", "0"),
            ("Trouser hem", ItemKind.SERVICE, "Alterations", "job", "400", "0", "0", "0"),
            ("Waist adjustment", ItemKind.SERVICE, "Alterations", "job", "800", "0", "0", "0"),
        ]
        for name, kind, category, unit, sell, cost, qty, reorder in catalogue:
            item = InventoryItem(
                shop_id=shop.id, name=name, kind=kind, category=category, unit=unit,
                sell_price=Decimal(sell), cost_price=Decimal(cost), quantity_on_hand=0,
                reorder_level=Decimal(reorder), track_stock=kind != ItemKind.SERVICE,
            )
            db.session.add(item)
            db.session.flush()
            if item.track_stock:
                apply_movement(item, Decimal(qty), MovementReason.PURCHASE, user_id=staff[UserRole.OWNER].id, note="Opening stock")

        for first, last, phone in (
            ("Wanjiru", "Kamau", "0722 111 222"),
            ("Otieno", "Odhiambo", "0733 444 555"),
            ("Amina", "Hassan", "0711 666 777"),
        ):
            customer = Customer(shop_id=shop.id, first_name=first, last_name=last, phone=normalize_phone(phone))
            db.session.add(customer)
            db.session.flush()
            db.session.add(Measurement(
                shop_id=shop.id, customer_id=customer.id, unit="in", taken_by_id=staff[UserRole.TAILOR].id,
                label="First fitting",
                values={"neck": "15.50", "shoulders": "18.00", "chest": "40.00", "waist": "34.00", "hips": "39.50", "sleeve_length": "25.00", "inseam": "31.00"},
            ))
        db.session.commit()
        click.echo("Demo data created. Sign in as owner@demo.test / demo-password")
