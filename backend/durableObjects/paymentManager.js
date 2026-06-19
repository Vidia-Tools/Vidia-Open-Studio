import { DEFAULT_CORS_HEADERS as corsHeaders } from '../middleware/cors.js';

export class PaymentManager {
	constructor(state, env) {
		this.state = state;
		this.env = env;
	}

	async fetch(request) {
		const url = new URL(request.url);
		const method = request.method;

		// Handle CORS preflight
		if (method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		try {
			// Get user payments
			if (method === 'GET' && url.pathname.startsWith('/api/payments/user/')) {
				const userId = url.pathname.split('/').pop();
				const payments = await this.getUserPayments(userId);
				return new Response(JSON.stringify({ success: true, payments }), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}

			// Create payment
			if (method === 'POST' && url.pathname === '/api/payments/create') {
				const paymentData = await request.json();
				const payment = await this.createPayment(paymentData);
				return new Response(JSON.stringify({ success: true, payment }), {
					status: 201,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}

			// Handle Stripe webhook
			if (method === 'POST' && url.pathname === '/api/payments/stripe/webhook') {
				// Empty handler for now - will be implemented later
				this.handleStripeWebhook(request, this.env);
				return new Response(JSON.stringify({ success: true }), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}

			// Create Stripe Checkout session
			if (method === 'POST' && url.pathname === '/api/payments/stripe/create-checkout-session') {
				const session = await this.createStripeCheckoutSession(request);
				return new Response(JSON.stringify({ success: true, session }), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}

			// Get Stripe session status
			if (method === 'GET' && url.pathname.startsWith('/api/payments/stripe/session/')) {
				const sessionId = url.pathname.split('/').pop();
				const session = await this.getStripeSessionStatus(sessionId);
				return new Response(JSON.stringify({ success: true, session }), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}

			return new Response('Not found', {
				status: 404,
				headers: corsHeaders,
			});
		} catch (error) {
			console.error('Payment Manager Error:', error);
			return new Response(
				JSON.stringify({
					success: false,
					error: error.message,
				}),
				{
					status: 500,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				}
			);
		}
	}

	async getUserPayments(userId) {
		const payments = await this.state.storage.list();
		return Array.from(payments.values())
			.filter((payment) => payment.userId === userId)
			.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
	}

	async createPayment(paymentData) {
		const paymentId = crypto.randomUUID();
		const payment = {
			paymentId,
			userId: paymentData.userId,
			amount: paymentData.amount,
			currency: paymentData.currency || 'USD',
			status: 'pending',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			metadata: paymentData.metadata || {},
		};

		await this.state.storage.put(paymentId, payment);
		return payment;
	}

	async createStripeCheckoutSession(request) {
		const { userId, amount, currency } = await request.json();
		const stripe = require('stripe')(this.env.STRIPE_SECRET_KEY);
		const YOUR_DOMAIN = this.env.CHECKOUT_RETURN_URL;
		const session = await stripe.checkout.sessions.create({
			ui_mode: 'embedded',
			line_items: [
				{
					// Provide the exact Price ID (for example, pr_1234) of the product you want to sell
					price: this.env.STRIPE_PRICE_ID,
					quantity: 1,
				},
			],
			mode: 'payment',
			return_url: `${YOUR_DOMAIN}/return.html?session_id={CHECKOUT_SESSION_ID}`,
			automatic_tax: { enabled: true },
		});

		return session;
	}

	async getStripeSessionStatus(sessionId) {
		const stripe = require('stripe')(this.env.STRIPE_SECRET_KEY);
		const session = await stripe.checkout.sessions.retrieve(sessionId);
		return session;
	}

	async handleStripeWebhook(request, env) {
		// Get the raw body as text first
		const rawBody = await request.text();
		const stripe = require('stripe')(env.STRIPE_SECRET_KEY);
		const endpointSecret = env.STRIPE_WEBHOOK_SECRET;
		const sig = request.headers.get('Stripe-Signature');
		let event;

		try {
			// Use constructEventAsync instead of constructEvent
			event = await stripe.webhooks.constructEventAsync(rawBody, sig, endpointSecret);
			console.log('Stripe webhook event:', event);
		} catch (err) {
			console.error('Webhook Error:', err.message);
			return new Response('Webhook signature verification failed', { status: 400 });
		}

		// Handle the event
		switch (event.type) {
			case 'payment_intent.succeeded':
				await this.handlePaymentSuccess(event.data.object);
				break;
			case 'payment_intent.payment_failed':
				await this.handlePaymentFailure(event.data.object);
				break;
			// Add more event types as needed
			default:
				console.log(`Unhandled event type ${event.type}`);
		}

		return new Response('Webhook received', { status: 200 });
	}

	async handlePaymentSuccess(paymentIntent, env) {
		console.log('Payment succeeded:', paymentIntent);
		/* const paymentId = paymentIntent.id;
		const userId = paymentIntent.metadata.userId; // Assuming you pass userId in metadata

		const paymentManagerId = env.PAYMENT_MANAGER.idFromName(userId);
		const paymentManager = env.PAYMENT_MANAGER.get(paymentManagerId);

		const updatedPayment = {
			paymentId: paymentId,
			userId: userId,
			status: 'succeeded',
			updatedAt: new Date().toISOString(),
		};

		await paymentManager.fetch(
			new Request(`/update`, {
				method: 'POST',
				body: JSON.stringify(updatedPayment),
			})
		); */
	}

	async handlePaymentFailure(paymentIntent, env) {
		const paymentId = paymentIntent.id;
		const userId = paymentIntent.metadata.userId;

		const paymentManagerId = env.PAYMENT_MANAGER.idFromName(userId);
		const paymentManager = env.PAYMENT_MANAGER.get(paymentManagerId);

		const updatedPayment = {
			paymentId: paymentId,
			userId: userId,
			status: 'failed',
			updatedAt: new Date().toISOString(),
		};

		await paymentManager.fetch(
			new Request(`/stripe/updatePayment`, {
				method: 'POST',
				body: JSON.stringify(updatedPayment),
			})
		);
	}
}
