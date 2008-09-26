jQuery.bosh = jQuery.extend({

	post: function( session, data, callback ) {
		if ( jQuery.isFunction( data ) ) {
			callback = data;
			data = {};
		}

		jQuery.bosh.log(data, '-Sent-');

		return jQuery.ajax({
			type: "POST",
			url: session.url,
			data: data,
			success: function(recvd, status) {
				session.lastResponse = recvd;
				jQuery.bosh.log(recvd, '+Recvd+');
				if (callback) callback(recvd, status);
			},
			dataType: "xml",
			contentType: "text/xml"
		});
	},

	setup: function( settings ) {
		jQuery.extend( jQuery.bosh.settings, settings )
	},
	
	settings: {
		protocol: 'http://jabber.org/protocol/httpbind',
		xmlns: 'urn:ietf:params:xml:ns:xmpp',
		resource: 'jquery-bosh',
		port: 5222,
		polling: false,
		debug: true // * Change back to false on release *
	},

	generateRid: function() {
		return Math.round(100000.5 + (((900000.49999) - (100000.5)) * Math.random()));
	},

	log: function( data, header ) {
		if (!jQuery.bosh.settings.debug) return true
		if (typeof console == 'undefined') return true
		try {
			if (header) console.log(header);
			if (typeof data.documentElement == 'undefined') 
				console.log(data);
			else
				console.log(data.documentElement);
		} catch (exception) {
			console.log(exception);
		}
	},

	tagBuilder: function( tag, attrs, data ) {
		var req = "<" + tag;
		
		if (typeof attrs == 'string') {
			data = attrs;
		}
		
		if (typeof attrs == 'object') {
			jQuery.each(attrs, function(k, v) {
				k = k.replace(/_/, ':');
				req += " " + k + "='" + v + "'";
			});
	  }
		
		if (typeof data == 'undefined')
			req += "/>";
		else
			req += ">" + data + "</" + tag + ">";
			
		return req;
	},

	toText: function( xmlResponse ) {
		if (xmlResponse == null) return false;
		if (typeof xmlResponse.xml != 'undefined') return xmlResponse.xml;
		try {
			if (typeof XMLSerializer == 'function') return (new XMLSerializer()).serializeToString(xmlResponse);
		} catch (exception) {
			jQuery.bosh.log(exception, 'Error when attempting XML serialization');
		}
		return false;
	},

	Message: function ( packet ) {
		this.from = null;
		this.message = null;
		this.timestamp = null;

		if (!packet) return;

		if (packet.getAttribute('from') && packet.getAttribute('from').split("@").length > 1)
			this.from = packet.getAttribute('from').split("@")[0];

		if (jQuery('body', packet).length > 0)
			this.message = jQuery('body', packet).text();

		if (jQuery('x[stamp]', packet).length > 0) {
			ts = jQuery('x[stamp]', packet).attr('stamp');
			this.timestamp = new Date();
			this.timestamp.setUTCFullYear(Number(ts.substr(0, 4)));
			this.timestamp.setUTCMonth(Number(ts.substr(4, 2)) - 1); // Javscript months are 0-11
			this.timestamp.setUTCDate(Number(ts.substr(6, 2)));
			this.timestamp.setUTCHours(Number(ts.substr(9, 2)));
			this.timestamp.setUTCMinutes(Number(ts.substr(12, 2)));
			this.timestamp.setUTCSeconds(Number(ts.substr(15, 2)));
		}
	},

	Session: function( url, username, password, to ) {
		this.url = ( url.match(/^https?:\/\//) == null ? 'http://' + url : url );
		this.to = ( to ? to : 'localhost' );
		this.route = 'xmpp:' + this.to + ':' + jQuery.bosh.settings.port;
		this.username = username;
		this.password = password;

		this.rid = jQuery.bosh.generateRid();
		this.lastResponse = null;
		this.connected = false;

		this.messageQueue = [];

		this.incrementRid = function() {
			this.rid += 1;
			return this.rid;
		};

		this.ingestMessages = function( data, self ) {
			self = ( self ? self : this );
			self.messageQueue = [];
			jQuery('message', data).each(function(k, v) { 
				self.messageQueue.push(new jQuery.bosh.Message(v));
			});
		};

		this.open = function() {
			if (this.connected) return true;

			var self = this;
			
			jQuery.bosh.post(self, self.requestSID(), function(data, status) {
				jQuery.each(['sid', 'wait', 'ver', 'inactivity', 'requests', 'polling'], function(k, v) {
					self[v] = data.documentElement.getAttribute(v);
				});

				jQuery.bosh.post(self, self.login(), function(data, status) {
					jQuery.bosh.post(self, self.bindToStream(), function(data, status) {
						jQuery.bosh.post(self, self.startSession(), function(data, status) {
							jQuery.bosh.post(self, self.setPresence(), function(data, status) {
								self.connected = true;
								self.ingestMessages(data, self);
							});
						});
					});
				});
			});
		};

		this.close = function() {
			var self = this;
			var packet = this.body({ type: 'terminate' }, 
									   jQuery.bosh.tagBuilder('presence', { type: 'unavailable', xmlns: 'jabber:client' }));
			
			jQuery.bosh.post(self, packet, function(data, status) {
				self.sid = null;
				self.rid = null;
				self.connected = false;
			});
		};

		this.sendMessage = function( recipient, msg ) {
			if (!this.connected) return false;

			var self = this;
			var to = recipient + '@' + this.to;
			var from = this.username + '@' + this.to;
			var packet = this.body({}, 
								     jQuery.bosh.tagBuilder('message', { xmlns: 'jabber:client', to: to, from: from },
								       jQuery.bosh.tagBuilder('body', msg)));

			jQuery.bosh.post(this, packet, function(data, status) {
				self.ingestMessages(data, self);
			});
		};

		this.listen = function( callback ) {
			if (!this.connected) return false;

			var self = this;
			jQuery.bosh.post(this, this.body({}), function(data, status) {
				self.ingestMessages(data, self);
				if (callback) callback(self.messageQueue);
			});
		};

		this.poll = function() {
			jQuery.bosh.post(this, this.body({}));
		};
		
		this.body = function( attrs, data ) {
			attrs = jQuery.extend(attrs, { rid: this.incrementRid(), sid: this.sid, xmlns: jQuery.bosh.settings.protocol });
			return jQuery.bosh.tagBuilder('body', attrs, data);
		};
		
		this.setPresence = function() {
			return this.body({}, jQuery.bosh.tagBuilder('presence', { xmlns: 'jabber:client' }));
		};
		
		this.startSession = function() {
			return this.body({}, 
						   jQuery.bosh.tagBuilder('iq', { xmlns: 'jabber:client', to: this.to, type: 'set', id: 'sess_1' },
						     jQuery.bosh.tagBuilder('session', { xmlns: jQuery.bosh.settings.xmlns + "-session" })));
		};
		
		this.bindToStream = function() {
			return this.body({ xmpp_restart: 'true' }, 
						   jQuery.bosh.tagBuilder('iq', { xmlns: 'jabber:client', to: this.to, type: 'set', id: 'bind_1' }, 
							   jQuery.bosh.tagBuilder('bind', { xmlns: jQuery.bosh.settings.xmlns + "-bind" }, 
								   jQuery.bosh.tagBuilder('resource', jQuery.bosh.settings.resource))));
		};
		
		this.login = function() {
			var auth = jQuery.base64Encode(this.username + '@' + this.to + String.fromCharCode(0) + this.username + String.fromCharCode(0) + this.password);
			var xmlns = jQuery.bosh.settings.xmlns + "-sasl";
			return this.body({}, jQuery.bosh.tagBuilder('auth', { xmlns: xmlns, mechanism: 'PLAIN' }, auth));
		};
		
		this.requestSID = function() {
			var attributes = {
				hold: 1, 
				wait: 300, 
				secure: false,
				ver: '1.6',
				xmpp_xmlns: 'urn:xmpp:xbosh',
				xmpp_version: '1.0'
			};

			// Check for polling
			if (jQuery.bosh.settings.polling) { attributes = jQuery.extend(attributes, { hold: 0, wait: 0 }) };
		
			attributes = jQuery.extend(attributes, { to: this.to, route: this.route, rid: this.rid, xmlns: jQuery.bosh.settings.protocol });
			return jQuery.bosh.tagBuilder('body', attributes);
		};
	}

});
