var marked = require('marked');

var InlineLexer = marked.InlineLexer;

var Parser = marked.Parser;


InlineLexer.prototype.html_output = InlineLexer.prototype.output;
InlineLexer.prototype.html_outputLink = InlineLexer.prototype.outputLink;

InlineLexer.prototype.roff_outputLink = function(cap, link) {
	var href = resc(link.href);
	var same = link.title == href;
	var text = '';
	if (same) text = '';
	else if (!link.title) text = this.output(cap[1]);
	if (text) text += ' ';
	return text
		+ '\\fI'
		+ href
		+ '\\fR';
};

InlineLexer.prototype.roff_output = function(src) {
	var out = ''
		, link
		, text
		, cap
		, cur;

	while (src) {
		// escape
		if ((cap = this.rules.escape.exec(src))) {
			src = src.substring(cap[0].length);
			out += lastMatch(cap);
			continue;
		}

		// autolink
		if ((cap = this.rules.autolink.exec(src))) {
			src = src.substring(cap[0].length);
			if (cap[2] === '@') {
				text = cap[1][6] === ':'
					? cap[1].substring(7)
					: cap[1];
			} else {
				text = cap[1];
			}
			out += resc(text);
			continue;
		}

		// url (gfm)
		if ((cap = this.rules.url.exec(src))) {
			src = src.substring(cap[0].length);
			out += resc(cap[0]);
			continue;
		}

		// tag
		if ((cap = this.rules.tag.exec(src))) {
			src = src.substring(cap[0].length);
			out += resc(cap[0]);
			continue;
		}

		// link
		if ((cap = this.rules.link.exec(src))) {
			src = src.substring(cap[0].length);
			out += this.outputLink(cap, {
				href: cap[2],
				title: cap[3]
			});
			continue;
		}

		// reflink, nolink
		if ((cap = this.rules.reflink.exec(src))
				|| (cap = this.rules.nolink.exec(src))) {
			src = src.substring(cap[0].length);
			cur = lastMatch(cap).replace(/\s+/g, ' ');
			link = this.links[cur.toLowerCase()];

			if (!link || !link.href) {
				out += cap[0][0];
				src = cap[0].substring(1) + src;
				continue;
			} else if (link.title) {
				out = out.slice(0, -cur.length);
			}
			out += this.outputLink(cap, link);
			continue;
		}

		// strong
		if ((cap = this.rules.strong.exec(src))) {
			src = src.substring(cap[0].length);
			out += '\\fB'
				+ this.output(lastMatch(cap))
				+ '\\fR';
			continue;
		}

		// em
		if ((cap = this.rules.em.exec(src))) {
			src = src.substring(cap[0].length);
			out += '\\fI'
				+ this.output(lastMatch(cap))
				+ '\\fR';
			continue;
		}

		// code
		if ((cap = this.rules.code.exec(src))) {
			src = src.substring(cap[0].length);
			out += '\\fB'
				+ resc(lastMatch(cap), true)
				+ '\\fP';
			continue;
		}

		// br
		if ((cap = this.rules.br.exec(src))) {
			src = src.substring(cap[0].length);
			out += '\n.br\n';
			continue;
		}

		// del (gfm)
		if ((cap = this.rules.del.exec(src))) {
			src = src.substring(cap[0].length);
			out += "-"
				+ resc(lastMatch(cap))
				+ "-";
			continue;
		}

		// text
		if ((cap = this.rules.text.exec(src))) {
			src = src.substring(cap[0].length);
			out += resc(cap[0]);
			continue;
		}

		if (src) {
			throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
		}
	}

	return out;
};


Parser.prototype.parse = function(src) {
	this.inline = new InlineLexer(src.links, this.options);
	this.tokens = src.reverse();

	if (this.options.format == "roff") {
		this.tok = this.roff_tok;
		this.inline.output = this.inline.roff_output;
		this.inline.outputLink = this.inline.roff_outputLink;
		var first = this.peek();
		if ((first.type != "heading" || first.depth != 1) && this.options.name) {
			this.tokens.push({type:"heading", depth:1});
		}
	} else {
		this.tok = this.html_tok;
		this.inline.output = this.inline.html_output;
		this.inline.outputLink = this.inline.html_outputLink;
	}

	// NOTE marked.js Parser.tok() relies on a this.inlineText reference.
	this.inlineText = this.inline;

	var out = '';
	while (this.next()) {
		out += this.tok();
	}

	return out;
};


Parser.prototype.html_tok = Parser.prototype.tok;

Parser.prototype.isNestList = false;
Parser.prototype.roff_tok = function() {
	var body;
	switch (this.token.type) {
	case 'space': {
		return '';
	}
	case 'hr': {
		return '.HR\n';
	}
	case 'heading': {
		var macro, text = this.token.text;
		if (this.token.depth == 1) {
			macro = 'TH';
			text = rparseHeader(text || "", this.options);
		} else if (this.token.depth == 2) {
			macro = 'SH';
			text = this.inline.output(text);
		} else {
			macro = 'SS';
			text = this.inline.output(text);
		}
		return '.'
				+ macro
				+ ' '
				+ text
				+ '\n';
	}
	case 'code': {
		if (this.options.highlight) {
			var code = this.options.highlight(this.token.text, this.token.lang);
			if (code != null && code !== this.token.text) {
				this.token.escaped = true;
				this.token.text = code;
			}
		}

		if (!this.token.escaped) {
			this.token.text = resc(this.token.text);
		}

		return '.P\n'
			+ '.RS 2\n'
			+ '.nf\n'
			+ this.token.text
			+ '\n.fi'
			+ '\n.RE\n';
	}
	case 'blockquote_start': {
		body = '';

		while (this.next().type !== 'blockquote_end') {
			body += this.tok();
		}

		return '.QP\n'
			+ body
			+ '\n.\n';
	}
	case 'list_start': {
		body = '';
		var order = this.token.ordered ? 1 : null;
		var originalLevel = this.isNestList;
		this.isNestList = true;
		while (this.next().type !== 'list_end') {
			if (order) this.token.order = order++;
			body += this.tok();
		}
		this.isNestList = originalLevel;

		var indent = this.isNestList ? '.RS\n' : '.RS 0\n';
		return indent
			+ body
			+ '\n.RE\n';
	}
	case 'loose_item_start':
	case 'list_item_start': {
		body = '';
		var bullet = '\\(bu';
		var offset = 2;
		if (this.token.order) {
			bullet = this.token.order + '.';
			offset = 3;
		}
		while (this.next().type !== 'list_item_end') {
			var tok = this.tok();
			if (this.options.ronn && !this.options.breaks) {
				// replace first line that ends with colons
				tok = tok.replace(":\n", '\n.br\n');
				// replace dot + newline | whitespaces with dot + line break
				tok = tok.replace(/\.(?:\n|\s\s+)/g, ".\n.br\n");
			}
			body += tok;
		}

		return '.IP '
			+ bullet
			+ ' '
			+ offset
			+ '\n'
			+ body;
	}
	case 'html': {
		return !this.token.pre && !this.options.pedantic
			? this.inline.output(this.token.text)
			: this.token.text;
	}
	case 'paragraph': {
		return '.P\n'
			+ this.inline.output(this.token.text)
			+ '\n';
	}
	case 'text': {
		return ''
			+ this.parseText()
			+ '\n';
	}

	/* deal with table format, add by gholk.
	 * use **tbl** macro format table in man page.
	 */
	case 'table': {
		var tblText = [],	// troff tbl macro text.
			rowArray = [];	// tmp array store cells in a table row.

		tblText.push('.TS');	// table start

		tblText.push('tab(|) expand nowarn box;');
		/* set `|` as seperator.
		 *
		 * set table border.
		 *
		 * set expand to full screen. without expand,
		 * tbl sometimes mistake terminal width.
		 * but expand is ugly sometimes...
		 *
		 * command need end by `;`.
		 */

		var columnNumberRow = '';

		for (var i=0; i<this.token.header.length; i++) {
			columnNumberRow += ' l';
			rowArray.push(
				'T{\n' +
				this.inline.output(this.token.header[i]) +
				'\nT}'
			);
		}
		columnNumberRow += '.';
		tblText.push(columnNumberRow);
		tblText.push(rowArray.join('|'));

		tblText.push('_');	// add an horizantle line after header


		/* run each row */
		for (var j=0; j < this.token.cells.length; j++) {
			rowArray = [];	// new array store cells in a row.
			var thisRow = this.token.cells[j];	// pointer to old array.

			/* run each cell */
			for (var k=0; k < thisRow.length; k++)
				rowArray.push('T{\n' + this.inline.output(thisRow[k]) + '\nT}');

			tblText.push(rowArray.join('|'));
		}

		tblText.push('.TE');

		return tblText.join('\n') + '\n';
	}
	}
};

function lastMatch(cap, exclude) {
	var len = cap.length;
	var cur;
	while (--len >= 0) {
		cur = cap[len];
		if (cur === exclude) continue;
		if (cur !== undefined) return cur;
	}
}

function quote(str) {
	return '"' + str + '"';
}

function resc(str) {
	if (str == null) return "";
	return rentities(str
	.replace(/\\/gm, "\\\\")
	.replace(/-/gm, "\\-")
	.replace(/^\./gm, "\\|.")
	.replace(/\./gm, "\\.")
	.replace(/^'/gm, "\\|'")).replace('&amp;', '&');
}

function rentities(str) {
	return str.replace(/&(\w+);/gm, function(match, ent) {
		var gr = {
			bull: '[ci]',
			nbsp: '~',
			copy: '(co',
			rdquo: '(rs',
			mdash: '(em',
			reg: '(rg',
			sect: '(sc',
			ge: '(>=',
			le: '(<=',
			ne: '(!=',
			equiv: '(==',
			plusmn: '(+-'
		}[ent];
		if (gr) return '\\' + gr;
		else return match;
	});
}

function rparseHeader(str, options) {
	var match = /^([\w_.[\]~+=@:-]+)\s*(?:\((\d\w*)\))?(?:\s*-+\s*(.*))?/.exec(str);
	var name, section, text;
	if (match) {
		name = match[1];
		section = match[2];
		text = match[3];
	}

	if (!name) name = options.name || "";
	if (!section) section = options.section || "";
	if (!text) {
		if (name || section) text = "";
		else text = str;
	}
	if (name && text) text = " - " + text;

	return quote(resc(name.toUpperCase()))
		+ " "
		+ quote(section)
		+ " "
		+ quote(manDate(options.date))
		+ " "
		+ quote(options.manVersion)
		+ " "
		+ quote(options.manual)
		+ "\n.SH "
		+ quote("NAME")
		+ "\n\\fB"
		+ name
		+ "\\fR"
		+ resc(text);
}
function manDate(date) {
	var stamp = parseInt(date);
	if (!isNaN(stamp) && stamp.toString().length == date.length) date = stamp;
	date = new Date(date);
	var month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][date.getMonth()];
	return month + " " + date.getFullYear();
}

marked.defaults.format = "roff";
marked.defaults.name = "";
if (marked.defaults.date == null) marked.defaults.date = new Date;
marked.defaults.section = "";
marked.defaults.manVersion = "";
marked.defaults.manual = "";
marked.defaults.gfm = true;
marked.defaults.breaks = false;
marked.defaults.ronn = false;

module.exports = marked;
