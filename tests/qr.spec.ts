import { test, expect } from '@playwright/test';
import { qrMatrix } from '../app/js/qr.js';

/*
 * The QR codes are drawn by app/js/qr.js, so nothing here needs a browser or
 * a network: the generator is run on fixed texts and compared, module for
 * module, with codes an independent encoder made for the same texts (byte
 * mode, error correction M, the mask its own scoring chose). Those reference
 * codes were made once and are stored below as static data — each row of
 * modules as a hexadecimal number, dark = 1 — so no QR library is installed
 * or downloaded to run this. They cover one block (versions 1 and 3), four
 * blocks with version information (7), and two block sizes at the largest
 * version made (10, the full 213 bytes).
 */
const reference = [
	{
		text: "A",
		size: 21,
		rows: '1fd27f 105f41 17455d 175b5d 174e5d 104b41 1fd57f 001b00 16e74b 0b2bc8 19da0d 16827c 13c924 001649 1fd328 105836 174df1 175e7e 175560 1044a5 1fd090'
	},
	{
		text: "https://acari.vercel.app/#remote=ABCDEF",
		size: 29,
		rows: '1fdb337f 105f1841 174bb25d 1758685d 17425e5d 1041d241 1fd5557f 001c2a00 16eed84b 158a3ef1 05649576 1f9697c1 18dd2eac 170ada47 16644ba7 1109b1d2 147535ba 0121b5ae 13503d24 05b71b64 0fe39ffc 001dd51f 1fd68f5a 1059051a 174879f4 1755f0b9 175b4625 104b533a 1fd727a2'
	},
	{
		text: "tick tick tick tick tick tick tick tick tick tick tick tick tick tick tick tick tick tick tick tick tick tick tick tick",
		size: 45,
		rows: '1fcc608a797f 104247941a41 175bf5255a5d 17519d48635d 175b6bfac75d 105f4516a841 1fd55555557f 00181f13ff00 17c9f7f2667c 04b63c09cba1 1674a0bf0dee 0e8d5b1b19bc 05c715f0c802 053cb3eaf185 1fe72534167a 19818415507f 1471bfd86880 0704498af3a1 0172ad968e4a 00bd3623fd16 0df3bffe63f1 171bb319c311 0f5929570f5e 0117d11b191c 19f249f0c9f2 0c06b749f1c7 057eb10615aa 16055cb5536f 03c26228a8b2 02b1e4daf321 15dad5e60f9a 00b79633de76 12c3da1e6071 18889bd9e385 016be1871da6 0f19ea571a4c 1371c5fcc5fa 00160d11f317 1fc763561d5a 10574f17511c 175df9f8abf0 17540228f013 175ac1c70dca 104fed031ea4 1fd326bea062'
	},
	{
		text: "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
		size: 57,
		rows: '1fd99c155555e7f 104ea42ccccca41 17545f7ccccce5d 174e9ebaaaaaa5d 1745951fd55525d 105f672c4cccc41 1fd55555555557f 00082c8c7333000 14617947d555425 191ae6e2aaaaaa3 02e278d73333135 07a8ec8b333303a 0fd1c9c15555453 179a6622aaaaaa3 05ee98573333135 05ac4c0b333303a 085568415555451 121a9562aaaaaa3 0166bf173333135 031851cb333303a 08e962815555453 129e9aa2aaaaaa3 19c1b0173333135 0b1a55cb333303a 10c06a815555453 1ab79aa2aaaaaa3 01f3b71ff3331f5 1319dccc733311a 1353d68d5555753 151536ac6aaa913 0ff30757f3331f5 18396cc4f3333ca 10c346ccd5556c3 0f2586a6aaaa8a2 0d53a7117333254 1e058cc4f3333c8 1543044cd5556c3 0fa585a6aaaa8a3 0cd3a8d17333255 19058884f3333ca 14430bccd5556c3 0fa78e66aaaa8a3 15d4a5d17333255 188b8e84f3333ca 15e40cccd5556c3 16a78a66aaaa8a3 14e426d17333255 1f2b4084f3333ca 0047d8cfd5557f3 00147e646aaab13 1fd5d6557333355 10491084733311a 1747c887d5557f3 17444eef2aaab30 175da65d7333157 104990cab3332a8 1fd3cb471555731'
	}
];

const hexRows = (m: boolean[][]) =>
	m.map((row) => BigInt('0b' + row.map((on) => (on ? 1 : 0)).join('')).toString(16).padStart(Math.ceil(row.length / 4), '0')).join(' ');

for (const { text, size, rows } of reference) {
	test(`a ${size}×${size} code matches the reference, module for module: ${text.slice(0, 40)}`, () => {
		const m = qrMatrix(text)!;
		expect(m.length).toBe(size);
		expect(m.every((row: boolean[]) => row.length === size)).toBe(true);
		expect(hexRows(m)).toBe(rows);
	});
}

test('the three finder patterns are where a scanner looks for them', () => {
	const m = qrMatrix('https://acari.vercel.app/#remote=ABCDEF')!;
	const n = m.length;
	const finder = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
	for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]])
		expect(finder.map((_, r) => m[r0 + r].slice(c0, c0 + 7).map((on: boolean) => (on ? 1 : 0)).join(''))).toEqual(finder);
});

test('a text too long for the largest code made is refused, not mangled', () => {
	expect(qrMatrix('q'.repeat(213))).not.toBeNull();
	expect(qrMatrix('q'.repeat(214))).toBeNull();
});
