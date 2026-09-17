import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import MCPClient from '../src/mcp-client.js';

test('Faker-backed tools work over local MCP stdio', {
  timeout: 15_000,
}, async (t) => {
  const client = new MCPClient({
    path: fileURLToPath(new URL('../src/mcp_server/index.js', import.meta.url)),
  });
  t.after(async () => {
    // Close even if initialization failed before isConnected became true.
    await client.client?.close();
    await client.transport?.close();
  });
  await client.connect();

  async function call(name, args) {
    return JSON.parse(await client.callTool(name, args));
  }

  await t.test(
    'advertises argument types, constraints and optional defaults',
    async () => {
      const tools = await client.listTools();
      for (const tool of tools) {
        assert.equal(tool.inputSchema.type, 'object');
        assert.ok(Object.keys(tool.inputSchema.properties).length > 0);
      }
      const product = tools.find(
        (tool) => tool.name === 'create_product',
      ).inputSchema;
      assert.equal(product.properties.name.type, 'string');
      assert.equal(product.properties.price.exclusiveMinimum, 0);
      assert.ok(product.required.includes('name'));
      assert.ok(product.required.includes('price'));
      assert.ok(!product.required.includes('unitOfMeasure'));
      assert.equal(product.properties.unitOfMeasure.default, 'unit');
      const orders = tools.find(
        (tool) => tool.name === 'query_orders',
      ).inputSchema;
      assert.equal(orders.properties.limit.minimum, 1);
      assert.equal(orders.properties.limit.maximum, 100);
      assert.equal(orders.properties.limit.default, 10);
      assert.ok(!orders.required?.includes('limit'));
    },
  );

  await t.test(
    'creates linked products, customers and orders with valid generated values',
    async () => {
      const product = await call('create_product', {
        name: 'Fixture notebook',
        sku: 'FIXTURE-001',
        category: 'office-supplies',
        price: 12.5,
        description: 'Local test fixture',
        supplier: 'Fixture supplier',
      });
      assert.equal(product.success, true);
      assert.match(product.product.id, /^PRD-[A-Z0-9]{8}$/);
      assert.ok(Number.isInteger(product.inventory.initialQuantity));
      assert.ok(product.inventory.initialQuantity >= 100);
      assert.ok(product.inventory.initialQuantity <= 1000);
      assert.ok(
        ['main-warehouse', 'east-warehouse', 'west-warehouse'].includes(
          product.inventory.warehouse,
        ),
      );

      const customer = await call('create_customer', {
        companyName: 'Fixture company',
        contactName: 'Fixture user',
        email: 'fixture@example.invalid',
        phone: '555-0100',
        address: {
          street: '1 Test Lane',
          city: 'Test City',
          state: 'CA',
          zipCode: '90001',
          country: 'USA',
        },
        creditLimit: 100,
        paymentTerms: 'prepaid',
      });
      assert.equal(customer.success, true);
      assert.match(customer.customer.id, /^CUST-[A-Z0-9]{6}$/);

      const { order, success } = await call('create_order', {
        customerId: customer.customer.id,
        items: [
          { productId: product.product.id, quantity: 2, unitPrice: 12.5 },
        ],
      });
      assert.equal(success, true);
      assert.match(order.id, /^ORD-\d+-[A-Z0-9]{6}$/);
      assert.equal(order.customerId, customer.customer.id);
      assert.equal(order.items[0].productId, product.product.id);
      assert.equal(order.subtotal, 25);
      assert.equal(order.tax, 2);
      assert.ok(order.shipping >= 10 && order.shipping <= 50);
      assert.ok(
        Math.abs(order.shipping * 100 - Math.round(order.shipping * 100)) <
          1e-8,
      );
      assert.equal(
        order.totalAmount,
        order.subtotal + order.tax + order.shipping,
      );
      const saved = await call('query_orders', {
        customerId: customer.customer.id,
      });
      assert.deepEqual(
        saved.orders.map((entry) => entry.id),
        [order.id],
      );
    },
  );

  await t.test(
    'generates bounded dates, quantities, addresses and weighted choices',
    async () => {
      const before = Date.now();
      const result = await call('query_orders', {
        customerId: 'CUST-LOCAL-FIXTURE',
        limit: 10,
      });
      const after = Date.now();
      assert.equal(result.count, 10);
      assert.equal(result.orders.length, 10);
      for (const order of result.orders) {
        assert.equal(order.customerId, 'CUST-LOCAL-FIXTURE');
        assert.ok(
          Date.parse(order.orderDate) >= before - 60 * 24 * 60 * 60 * 1000,
        );
        assert.ok(Date.parse(order.orderDate) <= after);
        assert.ok(
          [
            'pending',
            'processing',
            'shipped',
            'delivered',
            'cancelled',
          ].includes(order.status),
        );
        assert.ok(order.items.length >= 1 && order.items.length <= 5);
        for (const item of order.items) {
          assert.ok(
            Number.isInteger(item.quantity) &&
              item.quantity >= 1 &&
              item.quantity <= 20,
          );
          assert.ok([0, 5, 10].includes(item.discount));
          assert.ok(Number.isFinite(item.lineTotal) && item.lineTotal > 0);
        }
        for (const field of ['street', 'city', 'state', 'zipCode']) {
          assert.equal(typeof order.shippingAddress[field], 'string');
          assert.ok(order.shippingAddress[field].length > 0);
        }
      }
    },
  );

  await t.test(
    'generates finite financial summaries through the analytics tools',
    async () => {
      const result = await call('get_financial_summary', {
        startDate: '2024-01-01',
        endDate: '2024-01-03',
        groupBy: 'day',
      });
      assert.equal(result.data.length, 3);
      assert.ok(
        Number.isFinite(result.summary.totalRevenue) &&
          result.summary.totalRevenue > 0,
      );
      assert.ok(
        Number.isFinite(result.summary.totalExpenses) &&
          result.summary.totalExpenses > 0,
      );
      assert.ok(Number.isFinite(result.summary.totalProfit));
      assert.ok(
        result.trends.revenueGrowth >= -5 && result.trends.revenueGrowth <= 15,
      );
      assert.ok(
        result.trends.orderGrowth >= -3 && result.trends.orderGrowth <= 12,
      );
      assert.ok(
        result.trends.profitGrowth >= -8 && result.trends.profitGrowth <= 20,
      );
    },
  );

  await t.test(
    'returns a tool error for invalid input and stays available',
    async () => {
      const result = await client.client.callTool({
        name: 'create_product',
        arguments: { price: -1 },
      });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /^Error:/);
      const inventory = await call('query_inventory', {});
      assert.equal(typeof inventory, 'object');
      assert.ok(
        (await client.listTools()).some(
          (tool) => tool.name === 'create_product',
        ),
      );
    },
  );
});
